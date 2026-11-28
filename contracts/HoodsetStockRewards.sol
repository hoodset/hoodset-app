// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CanonicalAssets} from "./CanonicalAssets.sol";

/// @notice Optional HSET participation with independently claimable, actually funded Stock Tokens.
/// @dev No owner, upgrade, sweep, lockup, price oracle or automatic source-of-revenue claim.
///      Funding during a stream queues for the next cycle and cannot postpone its finish.
contract HoodsetStockRewards is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant DURATION = 7 days;
    uint256 public constant PRECISION = 1e36;
    uint256 public constant MAX_ACCOUNTING = 1e36;
    bytes32 public constant BUILD_ID = keccak256("HOODSET_STOCK_REWARDS_V1");
    bytes32 public constant HSET_RUNTIME = 0x040904d1ae06fb97e0a6fdf5ed8d79ac42209ff7c8965347f3a118f1b01a4738;
    address public constant CANONICAL_HSET = address(bytes20(hex"2c94879c2b482d1838ccce3cd00ffd96a82fbcb8"));
    address public stakingToken;
    address[] private _rewardTokens;
    uint256 public totalStaked;
    mapping(address => uint256) public balanceOf;
    struct Stream {
        uint256 budget;
        uint256 vested;
        uint256 start;
        uint256 finish;
        uint256 queued;
        uint256 carry;
        uint256 index;
        uint256 funded;
        uint256 paid;
    }
    Stream[] private _streams;
    mapping(address => mapping(uint256 => uint256)) public paidIndex;
    mapping(address => mapping(uint256 => uint256)) public accrued;
    mapping(address => mapping(uint256 => uint256)) public fraction;

    error InvalidAsset();
    error InvalidAmount();
    error AccountingLimit();
    error UnexpectedTransfer();
    error NothingToClaim();
    event Staked(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event RewardsFunded(address indexed funder, address indexed token, uint256 amount, bool queued);
    event StreamStarted(address indexed token, uint256 amount, uint256 start, uint256 finish);
    event RewardsClaimed(address indexed account, address indexed token, uint256 amount);

    constructor(address hset, address[] memory tokens) {
        if (hset == address(0) || hset.code.length == 0 || IERC20Metadata(hset).decimals() != 18) revert InvalidAsset();
        if (block.chainid == 4663 && (hset != CANONICAL_HSET || hset.codehash != HSET_RUNTIME)) revert InvalidAsset();
        if (tokens.length == 0 || tokens.length > 12) revert InvalidAsset();
        stakingToken = hset;
        for (uint256 i; i < tokens.length; i++) {
            address t = tokens[i];
            if (t == address(0) || t == hset || t.code.length == 0 || IERC20Metadata(t).decimals() != 18) revert InvalidAsset();
            if (block.chainid == 4663 && !CanonicalAssets.allowed(t)) revert InvalidAsset();
            for (uint256 j; j < i; j++) if (tokens[j] == t) revert InvalidAsset();
            _rewardTokens.push(t);
            _streams.push();
        }
    }

    function rewardTokens() external view returns (address[] memory) { return _rewardTokens; }

    function rewardState(uint256 i) external view returns (Stream memory r) {
        r = _streams[i];
        uint256 v = _vested(r);
        uint256 delta = v - r.vested;
        if (totalStaked == 0) r.carry += delta;
        else r.index += Math.mulDiv(delta, PRECISION, totalStaked);
        r.vested = v;
    }

    function earned(address account, uint256 i) public view returns (uint256) {
        Stream memory r = _streams[i];
        uint256 idx = r.index;
        if (totalStaked > 0) idx += Math.mulDiv(_vested(r) - r.vested, PRECISION, totalStaked);
        uint256 delta = idx - paidIndex[account][i];
        return accrued[account][i] + Math.mulDiv(balanceOf[account], delta, PRECISION)
            + (mulmod(balanceOf[account], delta, PRECISION) + fraction[account][i]) / PRECISION;
    }

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > MAX_ACCOUNTING - totalStaked) revert AccountingLimit();
        _update(msg.sender);
        IERC20 t = IERC20(stakingToken);
        uint256 beforeBalance = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        if (t.balanceOf(address(this)) - beforeBalance != amount) revert UnexpectedTransfer();
        totalStaked += amount;
        balanceOf[msg.sender] += amount;
        emit Staked(msg.sender, amount);
    }

    /// @dev Does not call, read or transfer any reward token. Earned rewards survive exit.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > balanceOf[msg.sender]) revert InvalidAmount();
        _update(msg.sender);
        balanceOf[msg.sender] -= amount;
        totalStaked -= amount;
        _send(stakingToken, msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice One asset per claim: a frozen reward asset cannot block other claims or HSET exit.
    function claim(uint256 i) external nonReentrant returns (uint256 amount) {
        _update(msg.sender);
        amount = accrued[msg.sender][i];
        if (amount == 0) revert NothingToClaim();
        accrued[msg.sender][i] = 0;
        _streams[i].paid += amount;
        if (_streams[i].paid > _streams[i].funded) revert AccountingLimit();
        _send(_rewardTokens[i], msg.sender, amount);
        emit RewardsClaimed(msg.sender, _rewardTokens[i], amount);
    }

    /// @notice Permissionless actual-token funding. No assertion that a deposit is protocol revenue.
    function fundRewards(uint256 i, uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        Stream storage r = _streams[i];
        if (amount > MAX_ACCOUNTING - r.funded) revert AccountingLimit();
        _settle(i);
        IERC20 t = IERC20(_rewardTokens[i]);
        uint256 beforeBalance = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        if (t.balanceOf(address(this)) - beforeBalance != amount) revert UnexpectedTransfer();
        r.funded += amount;
        bool queued = block.timestamp < r.finish;
        r.queued += amount;
        if (!queued) _start(i);
        emit RewardsFunded(msg.sender, _rewardTokens[i], amount, queued);
    }

    /// @notice Start an eligible queued cycle without backdating it; never changes an active finish.
    function checkpoint() external nonReentrant {
        for (uint256 i; i < _streams.length; i++) { _settle(i); _start(i); }
    }

    function _update(address account) private {
        for (uint256 i; i < _streams.length; i++) {
            _settle(i);
            _start(i);
            uint256 delta = _streams[i].index - paidIndex[account][i];
            uint256 rem = mulmod(balanceOf[account], delta, PRECISION) + fraction[account][i];
            accrued[account][i] += Math.mulDiv(balanceOf[account], delta, PRECISION) + rem / PRECISION;
            fraction[account][i] = rem % PRECISION;
            paidIndex[account][i] = _streams[i].index;
        }
    }

    function _vested(Stream memory r) private view returns (uint256) {
        if (r.finish == 0) return 0;
        uint256 until = Math.min(block.timestamp, r.finish);
        return Math.mulDiv(r.budget, until - r.start, DURATION);
    }

    function _settle(uint256 i) private {
        Stream storage r = _streams[i];
        uint256 v = _vested(r);
        uint256 delta = v - r.vested;
        if (totalStaked == 0) r.carry += delta;
        else r.index += Math.mulDiv(delta, PRECISION, totalStaked);
        r.vested = v;
    }

    function _start(uint256 i) private {
        Stream storage r = _streams[i];
        if (block.timestamp < r.finish || r.queued + r.carry == 0) return;
        r.budget = r.queued + r.carry;
        r.queued = 0;
        r.carry = 0;
        r.vested = 0;
        r.start = block.timestamp;
        r.finish = block.timestamp + DURATION;
        emit StreamStarted(_rewardTokens[i], r.budget, r.start, r.finish);
    }

    function _send(address token, address to, uint256 amount) private {
        IERC20 t = IERC20(token);
        uint256 fromBefore = t.balanceOf(address(this));
        uint256 toBefore = t.balanceOf(to);
        t.safeTransfer(to, amount);
        if (fromBefore - t.balanceOf(address(this)) != amount || t.balanceOf(to) - toBefore != amount) revert UnexpectedTransfer();
    }
}
