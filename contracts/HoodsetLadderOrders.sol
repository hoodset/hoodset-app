// SPDX-License-Identifier: MIT
pragma solidity 0.8.39;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CanonicalAssets} from "./CanonicalAssets.sol";
import {IOpenOceanBasket} from "./HoodsetBasketRouter.sol";

interface ILadderFeed {
    function decimals() external view returns (uint8);
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
interface ILadderStock { function oraclePaused() external view returns (bool); }

/// @notice Fixed-budget dip ladders with a net USDG take-profit on actual cost basis.
/// @dev Independent from basket vaults. No owner/admin, upgrades, fee, sweep or custody key.
///      Anyone may execute a valid bounded route; only the strategy owner may withdraw.
contract HoodsetLadderOrders is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    address public constant EXCHANGE = 0x6352a56caadC4F1E25CD6c75970Fa768A3304e64;
    address public constant EXECUTOR = 0x018fEADD83a8f2ad4d2508469a3a3215483C4377;
    bytes32 public constant BUILD_ID = keccak256("HOODSET_LADDER_ORDERS_V1");
    uint256 public constant MAX_FEED_AGE = 86400;
    uint256 private constant TOKEN_TO_USDG = 1e30; // 18 token decimals, 18 price decimals, 6 USDG decimals
    uint256 public nextId = 1;
    struct Market { address feed; uint8 decimals; uint32 maxAge; }
    struct Strategy {
        address owner;
        address token;
        uint64 expiresAt;
        uint16 profitBps;
        uint16 maxCycles;
        uint16 cycles;
        bool active;
        uint256 revision;
        uint256 budget;
        uint256 cash;
        uint256 tokens;
        uint256 cost;
    }
    struct Level { uint256 price; uint256 budget; uint256 remaining; }
    struct Route { uint256 amount; uint256 minimum; bytes data; }
    mapping(address => Market) public markets;
    mapping(uint256 => Strategy) public strategies;
    mapping(uint256 => Level[]) private _levels;
    mapping(address => uint256[]) private _owned;
    error Invalid(); error NotOwner(); error StalePrice(); error Paused();
    error Inactive(); error Changed(); error Limit(); error RouteError(); error TransferError();
    event Opened(uint256 indexed id, address indexed owner, address indexed token, uint256 budget);
    event Bought(uint256 indexed id, uint256 indexed level, uint256 spent, uint256 received, uint256 cost, uint256 tokens);
    event Sold(uint256 indexed id, uint256 tokens, uint256 received, uint256 cost, uint256 cycle, bool rearmed);
    event Stopped(uint256 indexed id);
    event Withdrawn(uint256 indexed id, address indexed token, uint256 amount);

    constructor(address[] memory tokens, address[] memory feeds, uint32[] memory maxAges) {
        if (block.chainid != 4663 || tokens.length == 0 || tokens.length > 17 || tokens.length != feeds.length || tokens.length != maxAges.length) revert Invalid();
        for (uint256 i; i < tokens.length; i++) {
            if (!CanonicalAssets.allowed(tokens[i]) || tokens[i].code.length == 0 || feeds[i].code.length == 0 || markets[tokens[i]].feed != address(0)) revert Invalid();
            uint8 decimals = ILadderFeed(feeds[i]).decimals();
            if (decimals > 18 || maxAges[i] == 0 || maxAges[i] > MAX_FEED_AGE) revert Invalid();
            markets[tokens[i]] = Market(feeds[i], decimals, maxAges[i]);
        }
    }
    function levels(uint256 id) external view returns (Level[] memory) { return _levels[id]; }
    function ownedCount(address owner) external view returns (uint256) { return _owned[owner].length; }
    function ownedId(address owner, uint256 index) external view returns (uint256) { return _owned[owner][index]; }
    function price(address token) public view returns (uint256 value) {
        Market memory m = markets[token];
        if (m.feed == address(0)) revert Invalid();
        if (ILadderStock(token).oraclePaused()) revert Paused();
        (uint80 round, int256 answer,,uint256 updated,uint80 answered) = ILadderFeed(m.feed).latestRoundData();
        if (answer <= 0 || round == 0 || answered < round || updated == 0 || updated > block.timestamp || block.timestamp - updated > m.maxAge) revert StalePrice();
        value = uint256(answer) * 10 ** (18-m.decimals);
        if (value > 1e30) revert Invalid();
    }
    function open(address token, uint256[] calldata prices, uint256[] calldata budgets, uint16 profitBps, uint16 maxCycles, uint64 expiresAt) external nonReentrant returns (uint256 id) {
        if (prices.length == 0 || prices.length > 8 || prices.length != budgets.length || profitBps < 100 || profitBps > 10000 || maxCycles == 0 || maxCycles > 100 || expiresAt <= block.timestamp || expiresAt > block.timestamp + 90 days) revert Invalid();
        uint256 mark = price(token); uint256 total;
        id = nextId++;
        for (uint256 i; i < prices.length; i++) {
            if (prices[i] == 0 || prices[i] >= mark || (i > 0 && prices[i] >= prices[i-1]) || budgets[i] < 1e6 || budgets[i] > 1e12) revert Invalid();
            total += budgets[i]; _levels[id].push(Level(prices[i],budgets[i],budgets[i]));
        }
        if (total > 1e12) revert Invalid();
        _pull(total);
        strategies[id] = Strategy(msg.sender,token,expiresAt,profitBps,maxCycles,0,true,0,total,total,0,0);
        _owned[msg.sender].push(id);
        emit Opened(id,msg.sender,token,total);
    }
    function minimumProceeds(uint256 id) public view returns (uint256) {
        Strategy storage s = strategies[id];
        return Math.mulDiv(s.cost,10000+s.profitBps,10000,Math.Rounding.Ceil);
    }
    function reserved(uint256 id) public view returns (uint256 n) {
        if (!strategies[id].active || block.timestamp >= strategies[id].expiresAt) return 0;
        Level[] storage rows = _levels[id]; for (uint256 i; i<rows.length; i++) n += rows[i].remaining;
    }
    function buy(uint256 id, uint256 index, uint256 revision, Route calldata route, uint256 deadline) external nonReentrant {
        Strategy storage s = _current(id,revision,deadline);
        if (index >= _levels[id].length) revert Invalid();
        Level storage row = _levels[id][index];
        if (price(s.token) > row.price || route.amount == 0 || route.amount > row.remaining || route.amount > s.cash) revert Limit();
        uint256 minimum = Math.mulDiv(route.amount,TOKEN_TO_USDG,row.price,Math.Rounding.Ceil);
        if (route.minimum < minimum) revert Limit();
        uint256 output = _swap(address(USDG),s.token,route);
        row.remaining -= route.amount; s.cash -= route.amount; s.cost += route.amount; s.tokens += output; s.revision++;
        emit Bought(id,index,route.amount,output,s.cost,s.tokens);
    }
    function sell(uint256 id, uint256 revision, Route calldata route, uint256 deadline) external nonReentrant {
        Strategy storage s = _current(id,revision,deadline);
        uint256 minimum = minimumProceeds(id);
        if (s.tokens == 0 || route.amount != s.tokens || route.minimum < minimum || Math.mulDiv(s.tokens,price(s.token),TOKEN_TO_USDG) < minimum) revert Limit();
        uint256 sold = s.tokens; uint256 cost = s.cost; uint256 output = _swap(s.token,address(USDG),route);
        s.cash += output; s.tokens = 0; s.cost = 0; s.cycles++; s.revision++;
        bool repeat = s.cycles < s.maxCycles && s.cash >= s.budget;
        s.active = repeat;
        if (repeat) { Level[] storage rows = _levels[id]; for (uint256 i; i<rows.length; i++) rows[i].remaining = rows[i].budget; }
        emit Sold(id,sold,output,cost,s.cycles,repeat);
    }
    function stop(uint256 id) external nonReentrant {
        Strategy storage s = _owner(id); if (!s.active) revert Inactive();
        s.active = false; s.revision++; emit Stopped(id);
    }
    function withdrawCash(uint256 id, uint256 amount) external nonReentrant {
        Strategy storage s = _owner(id);
        if (amount == 0 || amount > s.cash - reserved(id)) revert Limit();
        s.cash -= amount; s.revision++; _send(USDG,s.owner,amount); emit Withdrawn(id,address(USDG),amount);
    }
    function withdrawTokens(uint256 id, uint256 amount) external nonReentrant {
        Strategy storage s = _owner(id);
        if ((s.active && block.timestamp < s.expiresAt) || amount == 0 || amount > s.tokens) revert Limit();
        s.cost = amount == s.tokens ? 0 : s.cost - Math.mulDiv(s.cost,amount,s.tokens);
        s.tokens -= amount; s.revision++; _send(IERC20(s.token),s.owner,amount); emit Withdrawn(id,s.token,amount);
    }
    function _owner(uint256 id) private view returns (Strategy storage s) { s = strategies[id]; if (s.owner != msg.sender) revert NotOwner(); }
    function _current(uint256 id,uint256 revision,uint256 deadline) private view returns (Strategy storage s) {
        s = strategies[id];
        if (!s.active || block.timestamp >= s.expiresAt || block.timestamp > deadline || deadline > block.timestamp + 120) revert Inactive();
        if (s.revision != revision) revert Changed();
    }
    function _pull(uint256 amount) private {
        uint256 b = USDG.balanceOf(address(this)); USDG.safeTransferFrom(msg.sender,address(this),amount);
        if (USDG.balanceOf(address(this)) != b+amount) revert TransferError();
    }
    function _send(IERC20 token,address owner,uint256 amount) private {
        uint256 b = token.balanceOf(address(this)); uint256 o = token.balanceOf(owner); token.safeTransfer(owner,amount);
        if (token.balanceOf(address(this)) != b-amount || token.balanceOf(owner) != o+amount) revert TransferError();
    }
    function _swap(address input,address output,Route calldata route) private returns (uint256 received) {
        if (route.minimum == 0 || route.data.length < 4 || bytes4(route.data[:4]) != IOpenOceanBasket.swap.selector) revert RouteError();
        (address caller, IOpenOceanBasket.Description memory d, IOpenOceanBasket.Call[] memory calls) = abi.decode(route.data[4:],(address,IOpenOceanBasket.Description,IOpenOceanBasket.Call[]));
        if (caller != EXECUTOR || d.srcReceiver != EXECUTOR || d.srcToken != input || d.dstToken != output || d.amount != route.amount || d.minReturnAmount != route.minimum || (d.dstReceiver != address(this) && d.dstReceiver != address(0)) || d.flags != 2 || d.permit.length != 0 || calls.length == 0 || calls.length > 64) revert RouteError();
        for (uint256 i; i<calls.length; i++) if (calls[i].value != 0) revert RouteError();
        uint256 a = IERC20(input).balanceOf(address(this)); uint256 b = IERC20(output).balanceOf(address(this));
        IERC20(input).forceApprove(EXCHANGE,route.amount);
        (bool ok,) = EXCHANGE.call(route.data); if (!ok) revert RouteError();
        IERC20(input).forceApprove(EXCHANGE,0);
        if (IERC20(input).balanceOf(address(this)) != a-route.amount) revert TransferError();
        received = IERC20(output).balanceOf(address(this))-b;
        if (received < route.minimum) revert Limit();
    }
}
