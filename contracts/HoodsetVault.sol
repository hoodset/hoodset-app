// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CanonicalAssets} from "./CanonicalAssets.sol";

/// @notice Fixed-composition, pro-rata basket shares. No owner, upgrade, sweep or swap authority.
/// @dev Quantities per share do not respond to market prices. Donations and rounding belong to holders.
///      Reserved tokens are excluded from all outstanding-share backing calculations.
contract HoodsetVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant SCALE = 1e18;
    bytes32 public constant BUILD_ID = keccak256("HOODSET_VAULT_V1_2026_11_26");
    address public creator;
    uint256 public createdAt;
    uint256 public maxSupply;
    string public thesis;
    address[] private _assets;
    uint256[] private _initialQuantities;
    uint16[] private _initialWeights;
    uint256[] public reserved;
    struct Exit { address owner; bool claimed; uint256 shares; uint256[] amounts; }
    Exit[] private _exits;
    mapping(address => uint256[]) private _ownerExits;

    error InvalidComposition();
    error InvalidMetadata();
    error InvalidReceiver();
    error InvalidAmount();
    error SupplyLimit();
    error AmountChanged();
    error UnsupportedAsset(address asset);
    error UnexpectedTransfer(address asset);
    error InvalidExit();
    error MissingBacking(address asset);
    event SharesMinted(address indexed owner, address indexed receiver, uint256 shares, uint256[] amounts);
    event AssetsRedeemed(address indexed owner, address indexed receiver, uint256 shares, uint256[] amounts);
    event ExitReserved(address indexed owner, uint256 indexed exitId, uint256 shares, uint256[] amounts);
    event ExitClaimed(address indexed owner, uint256 indexed exitId, address receiver, uint256[] amounts);

    constructor(string memory name_, string memory symbol_, string memory thesis_, address[] memory assets_, uint256[] memory quantities_, uint16[] memory weights_, uint256 maxSupply_) ERC20(name_, symbol_) {
        if(bytes(name_).length==0 || bytes(name_).length>48 || bytes(thesis_).length==0 || bytes(thesis_).length>280 || bytes(symbol_).length<2 || bytes(symbol_).length>8) revert InvalidMetadata();
        bytes memory sym=bytes(symbol_);
        for(uint256 i;i<sym.length;i++) if(!((sym[i]>=0x41&&sym[i]<=0x5a)||(i>0&&sym[i]>=0x30&&sym[i]<=0x39))) revert InvalidMetadata();
        uint256 n=assets_.length;
        if(n<2 || n>12 || quantities_.length!=n || weights_.length!=n || maxSupply_==0 || maxSupply_>1_000_000*SCALE) revert InvalidComposition();
        uint256 sum;
        for(uint256 i;i<n;i++) {
            address a=assets_[i];
            if(a==address(0) || a.code.length==0 || IERC20Metadata(a).decimals()!=18) revert UnsupportedAsset(a);
            if(block.chainid==4663 && !CanonicalAssets.allowed(a)) revert UnsupportedAsset(a);
            if(quantities_[i]==0 || quantities_[i]>1e30 || weights_[i]==0) revert InvalidComposition();
            for(uint256 j;j<i;j++) if(assets_[j]==a) revert InvalidComposition();
            sum+=weights_[i]; reserved.push(0);
        }
        if(sum!=10_000) revert InvalidComposition();
        creator=msg.sender; createdAt=block.timestamp; thesis=thesis_; maxSupply=maxSupply_;
        _assets=assets_; _initialQuantities=quantities_; _initialWeights=weights_;
    }
    function assets() external view returns(address[] memory){return _assets;}
    function initialQuantities() external view returns(uint256[] memory){return _initialQuantities;}
    function initialWeights() external view returns(uint16[] memory){return _initialWeights;}
    function availableBalances() public view returns(uint256[] memory amounts){
        amounts=new uint256[](_assets.length);
        for(uint256 i;i<_assets.length;i++) {
            uint256 balance=IERC20(_assets[i]).balanceOf(address(this));
            if(balance<reserved[i]) revert MissingBacking(_assets[i]);
            amounts[i]=balance-reserved[i];
        }
    }
    function previewMint(uint256 shares) public view returns(uint256[] memory amounts){
        if(shares==0) revert InvalidAmount();
        uint256 supply=totalSupply(); uint256[] memory balances=availableBalances();
        amounts=new uint256[](_assets.length);
        for(uint256 i;i<amounts.length;i++) {
            if(supply>0 && balances[i]==0) revert MissingBacking(_assets[i]);
            amounts[i]=Math.mulDiv(supply==0?_initialQuantities[i]:balances[i], shares, supply==0?SCALE:supply, Math.Rounding.Ceil);
        }
    }
    function previewRedeem(uint256 shares) public view returns(uint256[] memory amounts){
        uint256 supply=totalSupply(); if(shares==0 || shares>supply) revert InvalidAmount();
        uint256[] memory balances=availableBalances(); amounts=new uint256[](_assets.length);
        for(uint256 i;i<amounts.length;i++) amounts[i]=Math.mulDiv(balances[i],shares,supply);
    }
    function mintShares(uint256 shares, address receiver, uint256[] calldata maxAmounts) external nonReentrant {
        _receiver(receiver); if(totalSupply()+shares>maxSupply) revert SupplyLimit();
        uint256[] memory amounts=previewMint(shares);
        if(maxAmounts.length!=amounts.length) revert InvalidComposition();
        for(uint256 i;i<amounts.length;i++) {
            if(amounts[i]>maxAmounts[i]) revert AmountChanged();
            IERC20 token=IERC20(_assets[i]); uint256 beforeBalance=token.balanceOf(address(this));
            token.safeTransferFrom(msg.sender,address(this),amounts[i]);
            if(token.balanceOf(address(this))-beforeBalance!=amounts[i]) revert UnexpectedTransfer(_assets[i]);
        }
        _mint(receiver,shares); emit SharesMinted(msg.sender,receiver,shares,amounts);
    }
    function redeem(uint256 shares,address receiver,uint256[] calldata minAmounts) external nonReentrant {
        _receiver(receiver); uint256[] memory amounts=previewRedeem(shares); _minimums(amounts,minAmounts);
        _burn(msg.sender,shares);
        for(uint256 i;i<amounts.length;i++) if(amounts[i]>0) _send(i,receiver,amounts[i]);
        emit AssetsRedeemed(msg.sender,receiver,shares,amounts);
    }
    function reserveExit(uint256 shares,uint256[] calldata minAmounts) external nonReentrant returns(uint256 id){
        uint256[] memory amounts=previewRedeem(shares); _minimums(amounts,minAmounts); _burn(msg.sender,shares);
        id=_exits.length; _exits.push(); Exit storage e=_exits[id];e.owner=msg.sender;e.shares=shares;e.amounts=amounts;
        _ownerExits[msg.sender].push(id);
        for(uint256 i;i<amounts.length;i++) reserved[i]+=amounts[i];
        emit ExitReserved(msg.sender,id,shares,amounts);
    }
    function claim(uint256 id,address receiver) external nonReentrant {
        _receiver(receiver); if(id>=_exits.length) revert InvalidExit(); Exit storage e=_exits[id];
        if(e.owner!=msg.sender||e.claimed) revert InvalidExit(); e.claimed=true;
        for(uint256 i;i<e.amounts.length;i++){reserved[i]-=e.amounts[i];if(e.amounts[i]>0)_send(i,receiver,e.amounts[i]);}
        emit ExitClaimed(msg.sender,id,receiver,e.amounts);
    }
    function exitCount(address owner) external view returns(uint256){return _ownerExits[owner].length;}
    function exitIdAt(address owner,uint256 index) external view returns(uint256){return _ownerExits[owner][index];}
    function exitInfo(uint256 id) external view returns(address owner,bool claimed,uint256 shares,uint256[] memory amounts){Exit storage e=_exits[id];return(e.owner,e.claimed,e.shares,e.amounts);}
    function _receiver(address r) private view {if(r==address(0)||r==address(this))revert InvalidReceiver();}
    function _minimums(uint256[] memory amounts,uint256[] calldata minimums) private pure {if(amounts.length!=minimums.length)revert InvalidComposition();for(uint256 i;i<amounts.length;i++)if(amounts[i]<minimums[i])revert AmountChanged();}
    function _send(uint256 i,address receiver,uint256 amount) private {IERC20 token=IERC20(_assets[i]);uint256 beforeBalance=token.balanceOf(receiver);uint256 vaultBefore=token.balanceOf(address(this));token.safeTransfer(receiver,amount);if(token.balanceOf(receiver)-beforeBalance!=amount||vaultBefore-token.balanceOf(address(this))!=amount)revert UnexpectedTransfer(_assets[i]);}
}
