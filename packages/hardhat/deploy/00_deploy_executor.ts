import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";
import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { saucerAddresses } from "../utils/saucerAddresses";

/**
 * Deploys RouterExecutor wired to the SaucerSwap routers of the target network.
 * Chain 296 → testnet, 295 → mainnet; the local Hedera fork uses testnet addresses.
 */
const deployRouterExecutor: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const chainId = Number(await hre.getChainId());
  const net = chainId === 295 ? "mainnet" : "testnet";
  const a = saucerAddresses[net];

  const result = await hre.deployments.deploy("RouterExecutor", {
    from: deployer,
    args: [a.v1Router, a.v2SwapRouter, a.whbarToken, a.whbarHelper],
    log: true,
    autoMine: true,
    gasLimit: "3000000",
    gasPrice: await getDeployGasPrice(hre),
  });

  if (chainId === 295 || chainId === 296) {
    console.log(`RouterExecutor on ${net}: https://hashscan.io/${net}/contract/${result.address}`);
    console.log(`NEXT_PUBLIC_ROUTER_EXECUTOR=${result.address}`);
  }
};

deployRouterExecutor.tags = ["RouterExecutor"];
export default deployRouterExecutor;
