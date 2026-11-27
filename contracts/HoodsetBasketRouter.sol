// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IExistingVault is IERC20 {
    function assets() external view returns (address[] memory);
    function initialQuantities() external view returns (uint256[] memory);
    function availableBalances() external view returns (uint256[] memory);
    function maxSupply() external view returns (uint256);
    function previewMint(uint256 shares) external view returns (uint256[] memory);
    function previewRedeem(uint256 shares) external view returns (uint256[] memory);
    function mintShares(uint256 shares, address receiver, uint256[] calldata maximums) external;
    function redeem(uint256 shares, address receiver, uint256[] calldata minimums) external;
}

interface IOpenOceanBasket {
    struct Description {
        address srcToken;
        address dstToken;
        address srcReceiver;
        address dstReceiver;
        uint256 amount;
        uint256 minReturnAmount;
        uint256 guaranteedAmount;
        uint256 flags;
        address referrer;
        bytes permit;
    }
    struct Call { uint256 target; uint256 gasLimit; uint256 value; bytes data; }
    function swap(address caller, Description calldata desc, Call[] calldata calls) external payable returns (uint256);
}

/// @notice Buys and mints, or redeems and sells, an existing HOODSET vault atomically.
/// @dev No owner, upgrades, arbitrary call entry point, asset sweep or retained user balance.
///      Existing donations are isolated from each call. Prices are bounded by user minimums.
contract HoodsetBasketRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 private constant SCALE = 1e18;
    IERC20 public constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    address public constant EXCHANGE = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64;
    address public constant EXECUTOR = 0x018fEADD83a8f2ad4d2508469a3a3215483C4377;
    bytes32 public constant VAULT_RUNTIME_HASH = 0xff6b4155860a506a2188d2bf92c001ab7362e8303cb304ed65243d64e5adc658;
    bytes32 public constant BUILD_ID = keccak256("HOODSET_BASKET_ROUTER_V1");

    struct Route { uint256 amount; uint256 minimum; bytes data; }
    error Expired();
    error InvalidVault();
    error InvalidAmount();
    error InvalidRoute();
    error BalanceChanged(address token);
    error InsufficientShares();
    error InsufficientProceeds();
    error UnexpectedTransfer(address token);
    error SwapFailed(uint256 component, bytes reason);

    event BasketBought(address indexed owner, address indexed vault, uint256 usdgSpent, uint256 shares, uint256[] contributed, uint256[] deposited, uint256[] refunds);
    event BasketSold(address indexed owner, address indexed vault, uint256 shares, uint256 usdgReceived, uint256[] amounts);

    /// @param contributed Exact component amounts from this wallet (e.g. an interrupted buy).
    /// @param budget Exact sum of the remaining USDG input amounts; never an unlimited spend.
    function buy(address vaultAddress, uint256 budget, uint256 minimumShares, uint256 deadline, uint256[] calldata contributed, Route[] calldata routes) external nonReentrant returns (uint256 shares) {
        _deadline(deadline);
        (IExistingVault vault, address[] memory assets) = _vault(vaultAddress);
        uint256 n = assets.length;
        if (routes.length != n || contributed.length != n || minimumShares == 0) revert InvalidAmount();
        uint256 total;
        uint256[] memory beforeAssets = _balances(assets);
        uint256 beforeUSDG = USDG.balanceOf(address(this));
        for (uint256 i; i < n; i++) {
            total += routes[i].amount;
            if (contributed[i] > 0) _pull(IERC20(assets[i]), contributed[i]);
            if (routes[i].amount == 0 && (routes[i].minimum != 0 || routes[i].data.length != 0)) revert InvalidRoute();
        }
        if (total != budget) revert InvalidAmount();
        if (budget > 0) _pull(USDG, budget);
        for (uint256 i; i < n; i++) {
            if (routes[i].amount > 0) _swap(address(USDG), assets[i], routes[i], i);
            _preserved(assets, beforeAssets, beforeUSDG);
        }

        uint256 supply = vault.totalSupply();
        uint256[] memory ratio = supply == 0 ? vault.initialQuantities() : vault.availableBalances();
        if (ratio.length != n || vault.maxSupply() < supply) revert InvalidVault();
        shares = vault.maxSupply() - supply;
        for (uint256 i; i < n; i++) {
            if (ratio[i] == 0) revert InvalidVault();
            uint256 gain = IERC20(assets[i]).balanceOf(address(this)) - beforeAssets[i];
            uint256 capacity = Math.mulDiv(gain, supply == 0 ? SCALE : supply, ratio[i]);
            if (capacity < shares) shares = capacity;
        }
        if (shares < minimumShares || shares == 0) revert InsufficientShares();
        uint256[] memory deposits = vault.previewMint(shares);
        if (deposits.length != n) revert InvalidVault();
        for (uint256 i; i < n; i++) {
            if (deposits[i] > IERC20(assets[i]).balanceOf(address(this)) - beforeAssets[i]) revert BalanceChanged(assets[i]);
            IERC20(assets[i]).forceApprove(vaultAddress, deposits[i]);
        }
        uint256 beforeShares = vault.balanceOf(msg.sender);
        vault.mintShares(shares, msg.sender, deposits);
        if (vault.balanceOf(msg.sender) - beforeShares != shares) revert UnexpectedTransfer(vaultAddress);
        uint256[] memory refunds = new uint256[](n);
        for (uint256 i; i < n; i++) {
            IERC20(assets[i]).forceApprove(vaultAddress, 0);
            refunds[i] = _refund(IERC20(assets[i]), beforeAssets[i]);
        }
        uint256 unspent = _refund(USDG, beforeUSDG);
        if (unspent > budget) revert BalanceChanged(address(USDG));
        emit BasketBought(msg.sender, vaultAddress, budget - unspent, shares, contributed, deposits, refunds);
    }

    function sell(address vaultAddress, uint256 shares, uint256 minimumUSDG, uint256 deadline, uint256[] calldata minimumRedeem, Route[] calldata routes) external nonReentrant returns (uint256 received) {
        _deadline(deadline);
        (IExistingVault vault, address[] memory assets) = _vault(vaultAddress);
        uint256 n = assets.length;
        if (shares == 0 || minimumUSDG == 0 || routes.length != n || minimumRedeem.length != n) revert InvalidAmount();
        uint256[] memory beforeAssets = _balances(assets);
        uint256 beforeUSDG = USDG.balanceOf(address(this));
        uint256 beforeShares = vault.balanceOf(address(this));
        _pull(vault, shares);
        vault.redeem(shares, address(this), minimumRedeem);
        if (vault.balanceOf(address(this)) != beforeShares) revert BalanceChanged(vaultAddress);
        uint256[] memory redeemed = new uint256[](n);
        for (uint256 i; i < n; i++) {
            uint256 amount = IERC20(assets[i]).balanceOf(address(this)) - beforeAssets[i];
            // A changed redemption cannot silently sell only part of the basket.
            if (amount == 0 || routes[i].amount != amount) revert BalanceChanged(assets[i]);
            redeemed[i] = amount;
            _swap(assets[i], address(USDG), routes[i], i);
            if (IERC20(assets[i]).balanceOf(address(this)) != beforeAssets[i]) revert BalanceChanged(assets[i]);
            _preserved(assets, beforeAssets, beforeUSDG);
        }
        received = USDG.balanceOf(address(this)) - beforeUSDG;
        if (received < minimumUSDG) revert InsufficientProceeds();
        _refund(USDG, beforeUSDG);
        emit BasketSold(msg.sender, vaultAddress, shares, received, redeemed);
    }

    function _vault(address a) private view returns (IExistingVault v, address[] memory assets) {
        if (block.chainid != 4663 || a.codehash != VAULT_RUNTIME_HASH || EXCHANGE.code.length == 0 || EXECUTOR.code.length == 0) revert InvalidVault();
        v = IExistingVault(a);
        assets = v.assets();
        if (assets.length < 2 || assets.length > 12) revert InvalidVault();
    }
    function _deadline(uint256 deadline) private view { if (block.timestamp > deadline) revert Expired(); }
    function _balances(address[] memory assets) private view returns (uint256[] memory b) {
        b = new uint256[](assets.length);
        for (uint256 i; i < b.length; i++) b[i] = IERC20(assets[i]).balanceOf(address(this));
    }
    function _pull(IERC20 token, uint256 amount) private {
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBalance != amount) revert UnexpectedTransfer(address(token));
    }
    function _refund(IERC20 token, uint256 baseline) private returns (uint256 amount) {
        uint256 balance = token.balanceOf(address(this));
        if (balance < baseline) revert BalanceChanged(address(token));
        amount = balance - baseline;
        if (amount > 0) {
            uint256 beforeReceiver = token.balanceOf(msg.sender);
            token.safeTransfer(msg.sender, amount);
            if (token.balanceOf(msg.sender) - beforeReceiver != amount || token.balanceOf(address(this)) != baseline) revert UnexpectedTransfer(address(token));
        }
    }
    function _preserved(address[] memory assets, uint256[] memory baseline, uint256 baseUSDG) private view {
        if (USDG.balanceOf(address(this)) < baseUSDG) revert BalanceChanged(address(USDG));
        for (uint256 i; i < assets.length; i++) if (IERC20(assets[i]).balanceOf(address(this)) < baseline[i]) revert BalanceChanged(assets[i]);
    }
    function _swap(address input, address output, Route calldata route, uint256 i) private {
        if (route.amount == 0 || route.minimum == 0 || route.data.length < 4 || bytes4(route.data[:4]) != IOpenOceanBasket.swap.selector) revert InvalidRoute();
        (address caller, IOpenOceanBasket.Description memory d, IOpenOceanBasket.Call[] memory calls) = abi.decode(route.data[4:], (address, IOpenOceanBasket.Description, IOpenOceanBasket.Call[]));
        if (caller != EXECUTOR || d.srcReceiver != EXECUTOR || d.srcToken != input || d.dstToken != output || d.amount != route.amount || d.minReturnAmount != route.minimum || (d.dstReceiver != address(this) && d.dstReceiver != address(0)) || d.flags != 2 || d.permit.length != 0 || calls.length == 0 || calls.length > 64) revert InvalidRoute();
        for (uint256 k; k < calls.length; k++) if (calls[k].value != 0) revert InvalidRoute();
        uint256 beforeInput = IERC20(input).balanceOf(address(this));
        uint256 beforeOutput = IERC20(output).balanceOf(address(this));
        IERC20(input).forceApprove(EXCHANGE, route.amount);
        (bool ok, bytes memory reason) = EXCHANGE.call(route.data);
        if (!ok) revert SwapFailed(i, reason);
        IERC20(input).forceApprove(EXCHANGE, 0);
        uint256 afterInput = IERC20(input).balanceOf(address(this));
        if (afterInput > beforeInput || beforeInput - afterInput != route.amount) revert BalanceChanged(input);
        if (IERC20(output).balanceOf(address(this)) - beforeOutput < route.minimum) revert InsufficientProceeds();
    }
}
