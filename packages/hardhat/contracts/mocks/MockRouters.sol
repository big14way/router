// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ISaucerV1Router, ISaucerV2SwapRouter, IWhbarHelper } from "../interfaces/ISaucerSwap.sol";
import { MockERC20 } from "./MockERC20.sol";

/// Shared pricing: `rate[in][out]` is output per 1e18 input, with an optional execution haircut.
abstract contract MockPricing {
    mapping(address => mapping(address => uint256)) public rate;
    uint256 public haircutBps;

    function setRate(address tokenIn, address tokenOut, uint256 rate1e18) external {
        rate[tokenIn][tokenOut] = rate1e18;
    }

    /// Simulate the price moving against the trade between quote and execution.
    function setHaircutBps(uint256 bps) external {
        haircutBps = bps;
    }

    function _quote(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256 out) {
        uint256 r = rate[tokenIn][tokenOut];
        require(r > 0, "mock: no rate");
        out = (amountIn * r) / 1e18;
        out -= (out * haircutBps) / 10_000;
    }
}

contract MockV1Router is ISaucerV1Router, MockPricing {
    address public immutable whbar;
    /// Fraction of HBAR input the router hands back unused (tests the executor's surplus refund).
    uint256 public refundBps;

    constructor(address whbar_) {
        whbar = whbar_;
    }

    function setRefundBps(uint256 bps) external {
        refundBps = bps;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external returns (uint256[] memory amounts) {
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        return _fill(amountIn, amountOutMin, path, to);
    }

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256
    ) external payable returns (uint256[] memory amounts) {
        require(path[0] == whbar, "mock: path must start with WHBAR");
        uint256 refund = (msg.value * refundBps) / 10_000;
        amounts = _fill(msg.value - refund, amountOutMin, path, to);
        if (refund > 0) {
            (bool ok, ) = msg.sender.call{ value: refund }("");
            require(ok, "mock: refund failed");
        }
    }

    function _fill(
        uint256 amountIn,
        uint256 minOut,
        address[] calldata path,
        address to
    ) private returns (uint256[] memory amounts) {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 1; i < path.length; i++) amounts[i] = _quote(path[i - 1], path[i], amounts[i - 1]);
        uint256 out = amounts[path.length - 1];
        require(out >= minOut, "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT");
        MockERC20(path[path.length - 1]).mint(to, out);
    }
}

contract MockV2Router is ISaucerV2SwapRouter, MockPricing {
    address public immutable whbar;
    /// HBAR the router has "wrapped" for swaps; only the surplus above this is refundable.
    uint256 public held;

    constructor(address whbar_) {
        whbar = whbar_;
    }

    receive() external payable {}

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        address tokenIn = address(bytes20(params.path[0:20]));
        address tokenOut = address(bytes20(params.path[params.path.length - 20:]));
        if (msg.value > 0) {
            require(tokenIn == whbar, "mock: value needs WHBAR path");
            require(msg.value >= params.amountIn, "mock: insufficient value");
            held += params.amountIn;
        } else {
            IERC20(tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        }
        // Multi-hop: price every 43-byte hop in sequence.
        uint256 amount = params.amountIn;
        uint256 offset = 0;
        while (offset + 43 <= params.path.length) {
            address a = address(bytes20(params.path[offset:offset + 20]));
            address b = address(bytes20(params.path[offset + 23:offset + 43]));
            amount = _quote(a, b, amount);
            offset += 23;
        }
        amountOut = amount;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        MockERC20(tokenOut).mint(params.recipient, amountOut);
    }

    /// Returns any HBAR this router still holds for the caller (Uniswap periphery semantics).
    function refundETH() external payable {
        uint256 surplus = address(this).balance - held;
        if (surplus > 0) {
            (bool ok, ) = msg.sender.call{ value: surplus }("");
            require(ok, "mock: refund failed");
        }
    }
}

/// Burns WHBAR pulled from the caller and pays out the same amount of HBAR (pre-funded in tests).
contract MockWhbarHelper is IWhbarHelper {
    MockERC20 public immutable whbar;

    constructor(MockERC20 whbar_) {
        whbar = whbar_;
    }

    receive() external payable {}

    function unwrapWhbar(uint256 wad) external {
        whbar.transferFrom(msg.sender, address(this), wad);
        whbar.burn(address(this), wad);
        (bool ok, ) = msg.sender.call{ value: wad }("");
        require(ok, "mock: hbar send failed");
    }
}

/// Recipient that tries to re-enter the executor when it receives HBAR.
contract ReentrantRecipient {
    address payable public immutable victim;
    bytes public payload;
    bool public reentered;

    constructor(address payable victim_) {
        victim = victim_;
    }

    function setPayload(bytes calldata data) external {
        payload = data;
    }

    receive() external payable {
        (bool ok, ) = victim.call(payload);
        reentered = ok;
    }
}
