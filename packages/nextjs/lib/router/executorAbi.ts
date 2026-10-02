/** RouterExecutor ABI (packages/hardhat/contracts/RouterExecutor.sol). Address comes from NEXT_PUBLIC_ROUTER_EXECUTOR. */
export const routerExecutorAbi = [
  {
    type: "function",
    name: "executeSplit",
    stateMutability: "payable",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      {
        name: "legs",
        type: "tuple[]",
        components: [
          { name: "venue", type: "uint8" },
          { name: "path", type: "bytes" },
          { name: "amountIn", type: "uint256" },
          { name: "minOut", type: "uint256" },
        ],
      },
      { name: "totalMinOut", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "unwrapToHbar", type: "bool" },
    ],
    outputs: [{ name: "totalOut", type: "uint256" }],
  },
  {
    type: "function",
    name: "planHash",
    stateMutability: "pure",
    inputs: [
      { name: "tokenIn", type: "address" },
      { name: "tokenOut", type: "address" },
      {
        name: "legs",
        type: "tuple[]",
        components: [
          { name: "venue", type: "uint8" },
          { name: "path", type: "bytes" },
          { name: "amountIn", type: "uint256" },
          { name: "minOut", type: "uint256" },
        ],
      },
      { name: "totalMinOut", type: "uint256" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "event",
    name: "RouteExecuted",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "tokenIn", type: "address", indexed: true },
      { name: "tokenOut", type: "address", indexed: true },
      { name: "amountIn", type: "uint256", indexed: false },
      { name: "totalOut", type: "uint256", indexed: false },
      { name: "planHash", type: "bytes32", indexed: false },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

/** HIP-719 token facade: calling `associate()` on the token's own EVM address associates the caller. */
export const hip719Abi = [
  { type: "function", name: "associate", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "int64" }] },
] as const;
