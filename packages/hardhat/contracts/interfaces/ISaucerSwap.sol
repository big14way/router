// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// SaucerSwap V1 router (UniswapV2-style). https://docs.saucerswap.finance/developers/v1/swap
interface ISaucerV1Router {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function swapExactETHForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);
}

/// SaucerSwap V2 swap router (UniswapV3-style). https://docs.saucerswap.finance/developers/v2/swap
interface ISaucerV2SwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);

    function refundETH() external payable;
}

/// SaucerSwap WhbarHelper: the only supported way to unwrap WHBAR. https://docs.saucerswap.finance/developers/whbar/overview
interface IWhbarHelper {
    function unwrapWhbar(uint256 wad) external;
}
