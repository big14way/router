// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { IHederaTokenService } from "./interfaces/IHederaTokenService.sol";
import { ISaucerV1Router, ISaucerV2SwapRouter, IWhbarHelper } from "./interfaces/ISaucerSwap.sol";

/// @title RouterExecutor
/// @notice Executes a smart-order-router plan atomically across SaucerSwap V1 and V2: every leg
///         runs in one transaction and the whole thing reverts unless the summed output clears
///         `totalMinOut`. No owner, no upgrade path, no custody beyond the call.
/// @dev    Hedera specifics: HBAR arrives as `msg.value` in tinybar (8 decimals) and is routed with
///         the WHBAR token address in paths; the contract self-associates to every HTS token it
///         touches through the HTS system contract at 0x167 (22 = SUCCESS, 23 = already associated).
contract RouterExecutor is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant VENUE_V1 = 0;
    uint8 public constant VENUE_V2 = 1;

    address public constant HTS = address(0x167);
    int64 private constant HTS_SUCCESS = 22;
    int64 private constant HTS_ALREADY_ASSOCIATED = 23;

    ISaucerV1Router public immutable v1Router;
    ISaucerV2SwapRouter public immutable v2Router;
    IERC20 public immutable whbar;
    IWhbarHelper public immutable whbarHelper;

    /// @notice One leg of a plan. `path` is `abi.encode(address[])` for V1 and the packed
    ///         `token|fee|token...` bytes for V2. `amountIn` and `minOut` are in smallest units.
    struct Leg {
        uint8 venue;
        bytes path;
        uint256 amountIn;
        uint256 minOut;
    }

    /// @dev Tokens this contract has already associated with; association cannot be undone here.
    mapping(address => bool) public associated;

    event RouteExecuted(
        address indexed sender,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 totalOut,
        bytes32 planHash
    );
    event TokenAssociated(address indexed token, int64 responseCode);

    error NoLegs();
    error Expired(uint256 deadline, uint256 blockTime);
    error BadVenue(uint8 venue);
    error HbarInputMustBeWhbar();
    error ValueMismatch(uint256 msgValue, uint256 totalIn);
    error UnwrapRequiresWhbarOut();
    error PathMismatch(uint256 legIndex);
    error InsufficientOutput(uint256 totalOut, uint256 totalMinOut);
    error AssociationFailed(address token, int64 responseCode);
    error HbarTransferFailed(address to, uint256 amount);
    error ZeroRecipient();

    constructor(ISaucerV1Router v1Router_, ISaucerV2SwapRouter v2Router_, IERC20 whbar_, IWhbarHelper whbarHelper_) {
        v1Router = v1Router_;
        v2Router = v2Router_;
        whbar = whbar_;
        whbarHelper = whbarHelper_;
    }

    /// @dev Accepts HBAR refunds from the V2 router (`refundETH`) and from WhbarHelper unwraps.
    receive() external payable {}

    /// @notice Execute every leg and deliver the summed output to `recipient`.
    /// @param tokenIn       Input token (WHBAR token address when paying HBAR via `msg.value`).
    /// @param tokenOut      Output token (WHBAR when `unwrapToHbar`).
    /// @param legs          Legs to execute; `sum(amountIn)` must equal `msg.value` for HBAR input.
    /// @param totalMinOut   Revert floor for the summed output (slippage protection for the plan).
    /// @param deadline      Unix seconds after which the call reverts.
    /// @param recipient     Receives `tokenOut` (or HBAR when `unwrapToHbar`).
    /// @param unwrapToHbar  Unwrap WHBAR output through WhbarHelper and send native HBAR.
    function executeSplit(
        address tokenIn,
        address tokenOut,
        Leg[] calldata legs,
        uint256 totalMinOut,
        uint256 deadline,
        address recipient,
        bool unwrapToHbar
    ) external payable nonReentrant returns (uint256 totalOut) {
        if (legs.length == 0) revert NoLegs();
        if (block.timestamp > deadline) revert Expired(deadline, block.timestamp);
        if (recipient == address(0)) revert ZeroRecipient();
        if (unwrapToHbar && tokenOut != address(whbar)) revert UnwrapRequiresWhbarOut();

        bytes32 hash = planHash(tokenIn, tokenOut, legs, totalMinOut);
        uint256 totalIn = _pullInput(tokenIn, legs);
        _associate(tokenOut);

        uint256 before = IERC20(tokenOut).balanceOf(address(this));
        for (uint256 i = 0; i < legs.length; i++) {
            _executeLeg(i, legs[i], tokenIn, tokenOut, msg.value > 0, deadline);
        }
        totalOut = IERC20(tokenOut).balanceOf(address(this)) - before;
        if (totalOut < totalMinOut) revert InsufficientOutput(totalOut, totalMinOut);

        _deliver(tokenOut, recipient, unwrapToHbar, totalOut);
        emit RouteExecuted(msg.sender, tokenIn, tokenOut, totalIn, totalOut, hash);
    }

    /// @dev HBAR input arrives as msg.value (must equal the summed leg input and use the WHBAR
    ///      address); token input is pulled from the caller after self-association.
    function _pullInput(address tokenIn, Leg[] calldata legs) private returns (uint256 totalIn) {
        for (uint256 i = 0; i < legs.length; i++) totalIn += legs[i].amountIn;
        if (msg.value > 0) {
            if (tokenIn != address(whbar)) revert HbarInputMustBeWhbar();
            if (msg.value != totalIn) revert ValueMismatch(msg.value, totalIn);
        } else {
            _associate(tokenIn);
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), totalIn);
        }
    }

    /// @dev Pays the output out (unwrapped to HBAR through WhbarHelper when asked) and returns any
    ///      HBAR the routers refunded for unused input to the caller.
    function _deliver(address tokenOut, address recipient, bool unwrapToHbar, uint256 totalOut) private {
        if (unwrapToHbar) {
            whbar.forceApprove(address(whbarHelper), totalOut);
            whbarHelper.unwrapWhbar(totalOut);
            _sendHbar(recipient, totalOut);
        } else {
            IERC20(tokenOut).safeTransfer(recipient, totalOut);
        }
        uint256 leftover = address(this).balance;
        if (leftover > 0) _sendHbar(msg.sender, leftover);
    }

    /// @notice Hash that identifies a plan: the SDK computes the same value off chain and the HCS
    ///         receipt carries it, so a mirror-node reader can match receipt ↔ log.
    function planHash(
        address tokenIn,
        address tokenOut,
        Leg[] calldata legs,
        uint256 totalMinOut
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut, legs, totalMinOut));
    }

    function _executeLeg(
        uint256 index,
        Leg calldata leg,
        address tokenIn,
        address tokenOut,
        bool hbarIn,
        uint256 deadline
    ) private {
        if (leg.venue == VENUE_V1) {
            address[] memory path = abi.decode(leg.path, (address[]));
            if (path.length < 2 || path[0] != tokenIn || path[path.length - 1] != tokenOut) revert PathMismatch(index);
            if (hbarIn) {
                v1Router.swapExactETHForTokens{ value: leg.amountIn }(leg.minOut, path, address(this), deadline);
            } else {
                IERC20(tokenIn).forceApprove(address(v1Router), leg.amountIn);
                v1Router.swapExactTokensForTokens(leg.amountIn, leg.minOut, path, address(this), deadline);
            }
        } else if (leg.venue == VENUE_V2) {
            if (leg.path.length < 43 || _first(leg.path) != tokenIn || _last(leg.path) != tokenOut)
                revert PathMismatch(index);
            ISaucerV2SwapRouter.ExactInputParams memory params = ISaucerV2SwapRouter.ExactInputParams({
                path: leg.path,
                recipient: address(this),
                deadline: deadline,
                amountIn: leg.amountIn,
                amountOutMinimum: leg.minOut
            });
            if (hbarIn) {
                v2Router.exactInput{ value: leg.amountIn }(params);
                v2Router.refundETH();
            } else {
                IERC20(tokenIn).forceApprove(address(v2Router), leg.amountIn);
                v2Router.exactInput(params);
            }
        } else {
            revert BadVenue(leg.venue);
        }
    }

    /// @dev Associate once per token. HTS returns 22 on success and 23 when already associated.
    function _associate(address token) private {
        if (associated[token]) return;
        (bool ok, bytes memory ret) = HTS.call(
            abi.encodeWithSelector(IHederaTokenService.associateToken.selector, address(this), token)
        );
        int64 code = ok && ret.length >= 32 ? abi.decode(ret, (int64)) : int64(0);
        if (code != HTS_SUCCESS && code != HTS_ALREADY_ASSOCIATED) revert AssociationFailed(token, code);
        associated[token] = true;
        emit TokenAssociated(token, code);
    }

    function _sendHbar(address to, uint256 amount) private {
        (bool ok, ) = to.call{ value: amount }("");
        if (!ok) revert HbarTransferFailed(to, amount);
    }

    function _first(bytes calldata path) private pure returns (address a) {
        a = address(bytes20(path[0:20]));
    }

    function _last(bytes calldata path) private pure returns (address a) {
        a = address(bytes20(path[path.length - 20:]));
    }
}
