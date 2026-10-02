import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers, network } from "hardhat";
import type {
  MockERC20,
  MockHTS,
  MockV1Router,
  MockV2Router,
  MockWhbarHelper,
  RouterExecutor,
} from "../typechain-types";

const HTS = "0x0000000000000000000000000000000000000167";
const E18 = 10n ** 18n;
const coder = ethers.AbiCoder.defaultAbiCoder();
const LEG_TUPLE = "tuple(uint8 venue,bytes path,uint256 amountIn,uint256 minOut)[]";

type Leg = { venue: number; path: string; amountIn: bigint; minOut: bigint };
const v1Path = (tokens: string[]) => coder.encode(["address[]"], [tokens]);
const v2Path = (tokens: string[], fees: number[]) =>
  ethers.solidityPacked(
    tokens.flatMap((t, i) => (i === 0 ? ["address"] : ["uint24", "address"])),
    tokens.flatMap((t, i) => (i === 0 ? [t] : [fees[i - 1]!, t])),
  );
const planHash = (tokenIn: string, tokenOut: string, legs: Leg[], totalMinOut: bigint) =>
  ethers.keccak256(
    coder.encode(
      ["address", "address", LEG_TUPLE, "uint256"],
      [tokenIn, tokenOut, legs.map(l => [l.venue, l.path, l.amountIn, l.minOut]), totalMinOut],
    ),
  );
const far = () => BigInt(Math.floor(Date.now() / 1000) + 3600);

describe("RouterExecutor", function () {
  let executor: RouterExecutor, v1: MockV1Router, v2: MockV2Router, helper: MockWhbarHelper;
  let whbar: MockERC20, sauce: MockERC20, hts: MockHTS;
  let user: Awaited<ReturnType<typeof ethers.getSigners>>[number];
  let addr: Record<string, string>;

  async function deployFixture() {
    const [user] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockERC20");
    const whbar = (await Mock.deploy("Wrapped Hbar", "WHBAR", 8)) as MockERC20;
    const sauce = (await Mock.deploy("Sauce", "SAUCE", 6)) as MockERC20;
    const usdc = (await Mock.deploy("USD Coin", "USDC", 6)) as MockERC20;
    const v1 = (await (
      await ethers.getContractFactory("MockV1Router")
    ).deploy(await whbar.getAddress())) as MockV1Router;
    const v2 = (await (
      await ethers.getContractFactory("MockV2Router")
    ).deploy(await whbar.getAddress())) as MockV2Router;
    const helper = (await (
      await ethers.getContractFactory("MockWhbarHelper")
    ).deploy(await whbar.getAddress())) as MockWhbarHelper;
    const htsImpl = await (await ethers.getContractFactory("MockHTS")).deploy();
    await network.provider.send("hardhat_setCode", [HTS, await ethers.provider.getCode(await htsImpl.getAddress())]);
    const hts = (await ethers.getContractAt("MockHTS", HTS)) as MockHTS;
    const executor = (await (
      await ethers.getContractFactory("RouterExecutor")
    ).deploy(
      await v1.getAddress(),
      await v2.getAddress(),
      await whbar.getAddress(),
      await helper.getAddress(),
    )) as RouterExecutor;
    const addr = {
      whbar: await whbar.getAddress(),
      sauce: await sauce.getAddress(),
      usdc: await usdc.getAddress(),
      exec: await executor.getAddress(),
    };
    // V1: 1 WHBAR → 50 SAUCE, V2: 1 WHBAR → 40 SAUCE; USDC legs for multi-hop.
    await v1.setRate(addr.whbar, addr.sauce, (50n * E18) / 100n); // 8 → 6 decimals: 1e8 in → 5e7 out
    await v2.setRate(addr.whbar, addr.sauce, (40n * E18) / 100n);
    await v1.setRate(addr.sauce, addr.whbar, (E18 * 100n) / 50n);
    await v2.setRate(addr.whbar, addr.usdc, (20n * E18) / 100n);
    await v2.setRate(addr.usdc, addr.sauce, 2n * E18);
    await whbar.mint(user.address, 1_000n * 10n ** 8n);
    await whbar.connect(user).approve(addr.exec, ethers.MaxUint256);
    await user.sendTransaction({ to: await helper.getAddress(), value: ethers.parseEther("10") });
    return { executor, v1, v2, helper, whbar, sauce, usdc, hts, user, addr };
  }

  beforeEach(async function () {
    ({ executor, v1, v2, helper, whbar, sauce, hts, user, addr } = await loadFixture(deployFixture));
  });

  const exec = (
    tokenIn: string,
    tokenOut: string,
    legs: Leg[],
    totalMinOut: bigint,
    opts: { value?: bigint; recipient?: string; unwrap?: boolean; deadline?: bigint } = {},
  ) =>
    executor
      .connect(user)
      .executeSplit(
        tokenIn,
        tokenOut,
        legs,
        totalMinOut,
        opts.deadline ?? far(),
        opts.recipient ?? user.address,
        opts.unwrap ?? false,
        { value: opts.value ?? 0n },
      );

  it("executes a single V1 leg and emits RouteExecuted with the plan hash", async function () {
    const legs = [{ venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 10n ** 8n, minOut: 49_000_000n }];
    const hash = planHash(addr.whbar, addr.sauce, legs, 49_500_000n);
    expect(await executor.planHash(addr.whbar, addr.sauce, legs, 49_500_000n)).to.equal(hash);
    await expect(exec(addr.whbar, addr.sauce, legs, 49_500_000n))
      .to.emit(executor, "RouteExecuted")
      .withArgs(user.address, addr.whbar, addr.sauce, 10n ** 8n, 50_000_000n, hash);
    expect(await sauce.balanceOf(user.address)).to.equal(50_000_000n);
    expect(await sauce.balanceOf(addr.exec)).to.equal(0n);
  });

  it("executes a single V2 leg (packed path) and a two-hop V2 leg", async function () {
    const legs = [{ venue: 1, path: v2Path([addr.whbar, addr.sauce], [3000]), amountIn: 10n ** 8n, minOut: 0n }];
    await exec(addr.whbar, addr.sauce, legs, 40_000_000n);
    expect(await sauce.balanceOf(user.address)).to.equal(40_000_000n);
    const hop = [
      { venue: 1, path: v2Path([addr.whbar, addr.usdc, addr.sauce], [1500, 3000]), amountIn: 10n ** 8n, minOut: 0n },
    ];
    await exec(addr.whbar, addr.sauce, hop, 0n);
    expect(await sauce.balanceOf(user.address)).to.equal(80_000_000n); // 1 WHBAR → 20 USDC → 40 SAUCE
  });

  it("splits across V1 and V2 atomically and sums the output", async function () {
    const legs = [
      { venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 6n * 10n ** 7n, minOut: 0n },
      { venue: 1, path: v2Path([addr.whbar, addr.sauce], [3000]), amountIn: 4n * 10n ** 7n, minOut: 0n },
    ];
    await expect(exec(addr.whbar, addr.sauce, legs, 46_000_000n))
      .to.emit(executor, "RouteExecuted")
      .withArgs(
        user.address,
        addr.whbar,
        addr.sauce,
        10n ** 8n,
        46_000_000n,
        planHash(addr.whbar, addr.sauce, legs, 46_000_000n),
      );
    expect(await sauce.balanceOf(user.address)).to.equal(46_000_000n);
    expect(await whbar.balanceOf(user.address)).to.equal(999n * 10n ** 8n);
  });

  it("reverts the whole split when the summed output is below totalMinOut", async function () {
    const legs = [
      { venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 5n * 10n ** 7n, minOut: 0n },
      { venue: 1, path: v2Path([addr.whbar, addr.sauce], [3000]), amountIn: 5n * 10n ** 7n, minOut: 0n },
    ];
    await v2.setHaircutBps(500);
    await expect(exec(addr.whbar, addr.sauce, legs, 45_000_000n))
      .to.be.revertedWithCustomError(executor, "InsufficientOutput")
      .withArgs(44_000_000n, 45_000_000n);
    expect(await sauce.balanceOf(user.address)).to.equal(0n);
    expect(await whbar.balanceOf(user.address)).to.equal(1_000n * 10n ** 8n);
    // a per-leg minOut is enforced by the venue itself
    const strict = [{ venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 10n ** 8n, minOut: 60_000_000n }];
    await expect(exec(addr.whbar, addr.sauce, strict, 0n)).to.be.revertedWith(
      "UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT",
    );
  });

  it("takes HBAR as msg.value for V1 and V2 legs and refunds unused HBAR to the caller", async function () {
    const legs = [
      { venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 5n * 10n ** 7n, minOut: 0n },
      { venue: 1, path: v2Path([addr.whbar, addr.sauce], [3000]), amountIn: 5n * 10n ** 7n, minOut: 0n },
    ];
    await v1.setRefundBps(1000); // V1 hands back 10% of its HBAR input
    const before = await ethers.provider.getBalance(user.address);
    const tx = await exec(addr.whbar, addr.sauce, legs, 0n, { value: 10n ** 8n });
    const rc = await tx.wait();
    const gas = rc!.gasUsed * rc!.gasPrice;
    const after = await ethers.provider.getBalance(user.address);
    expect(before - after - gas).to.equal(10n ** 8n - 5n * 10n ** 6n); // 0.05 HBAR came back
    expect(await ethers.provider.getBalance(addr.exec)).to.equal(0n);
    expect(await sauce.balanceOf(user.address)).to.equal(22_500_000n + 20_000_000n);
    expect(await whbar.balanceOf(user.address)).to.equal(1_000n * 10n ** 8n); // no WHBAR pulled
  });

  it("validates HBAR input: WHBAR path required and value must equal the summed amountIn", async function () {
    const legs = [{ venue: 0, path: v1Path([addr.sauce, addr.whbar]), amountIn: 10n ** 8n, minOut: 0n }];
    await expect(exec(addr.sauce, addr.whbar, legs, 0n, { value: 10n ** 8n })).to.be.revertedWithCustomError(
      executor,
      "HbarInputMustBeWhbar",
    );
    const ok = [{ venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 10n ** 8n, minOut: 0n }];
    await expect(exec(addr.whbar, addr.sauce, ok, 0n, { value: 10n ** 8n - 1n }))
      .to.be.revertedWithCustomError(executor, "ValueMismatch")
      .withArgs(10n ** 8n - 1n, 10n ** 8n);
  });

  it("unwraps WHBAR output to native HBAR through WhbarHelper", async function () {
    await sauce.mint(user.address, 100_000_000n);
    await sauce.connect(user).approve(addr.exec, ethers.MaxUint256);
    const legs = [{ venue: 0, path: v1Path([addr.sauce, addr.whbar]), amountIn: 50_000_000n, minOut: 0n }];
    const before = await ethers.provider.getBalance(user.address);
    const tx = await exec(addr.sauce, addr.whbar, legs, 10n ** 8n, { unwrap: true });
    const rc = await tx.wait();
    const after = await ethers.provider.getBalance(user.address);
    expect(after - before + rc!.gasUsed * rc!.gasPrice).to.equal(10n ** 8n);
    expect(await whbar.balanceOf(addr.exec)).to.equal(0n);
    await expect(
      exec(
        addr.whbar,
        addr.sauce,
        [{ venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 1n, minOut: 0n }],
        0n,
        { unwrap: true },
      ),
    ).to.be.revertedWithCustomError(executor, "UnwrapRequiresWhbarOut");
  });

  it("self-associates once per token (22 then cached) and surfaces HTS failures", async function () {
    const legs = [{ venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 10n ** 8n, minOut: 0n }];
    await expect(exec(addr.whbar, addr.sauce, legs, 0n))
      .to.emit(executor, "TokenAssociated")
      .withArgs(addr.whbar, 22)
      .and.to.emit(executor, "TokenAssociated")
      .withArgs(addr.sauce, 22);
    expect(await hts.calls()).to.equal(2n);
    await exec(addr.whbar, addr.sauce, legs, 0n);
    expect(await hts.calls()).to.equal(2n); // cached: no second HTS call
    expect(await executor.associated(addr.sauce)).to.equal(true);
    // a fresh executor against an HTS that reports "already associated" (23) is also fine
    const fresh = (await (
      await ethers.getContractFactory("RouterExecutor")
    ).deploy(await v1.getAddress(), await v2.getAddress(), addr.whbar, await helper.getAddress())) as RouterExecutor;
    await whbar.connect(user).approve(await fresh.getAddress(), ethers.MaxUint256);
    await expect(fresh.connect(user).executeSplit(addr.whbar, addr.sauce, legs, 0n, far(), user.address, false))
      .to.emit(fresh, "TokenAssociated")
      .withArgs(addr.whbar, 22);
    await hts.setFailCode(184); // TOKEN_NOT_ASSOCIATED_TO_ACCOUNT-style failure
    const failing = (await (
      await ethers.getContractFactory("RouterExecutor")
    ).deploy(await v1.getAddress(), await v2.getAddress(), addr.whbar, await helper.getAddress())) as RouterExecutor;
    await whbar.connect(user).approve(await failing.getAddress(), ethers.MaxUint256);
    await expect(failing.connect(user).executeSplit(addr.whbar, addr.sauce, legs, 0n, far(), user.address, false))
      .to.be.revertedWithCustomError(failing, "AssociationFailed")
      .withArgs(addr.whbar, 184);
  });

  it("blocks reentrancy from the HBAR recipient", async function () {
    await sauce.mint(user.address, 100_000_000n);
    await sauce.connect(user).approve(addr.exec, ethers.MaxUint256);
    const evil = await (await ethers.getContractFactory("ReentrantRecipient")).deploy(addr.exec);
    const legs = [{ venue: 0, path: v1Path([addr.sauce, addr.whbar]), amountIn: 50_000_000n, minOut: 0n }];
    await evil.setPayload(
      executor.interface.encodeFunctionData("executeSplit", [
        addr.sauce,
        addr.whbar,
        legs,
        0n,
        far(),
        await evil.getAddress(),
        true,
      ]),
    );
    await exec(addr.sauce, addr.whbar, legs, 0n, { unwrap: true, recipient: await evil.getAddress() });
    expect(await evil.reentered()).to.equal(false);
    expect(await ethers.provider.getBalance(await evil.getAddress())).to.equal(10n ** 8n);
  });

  it("rejects malformed plans", async function () {
    await expect(exec(addr.whbar, addr.sauce, [], 0n)).to.be.revertedWithCustomError(executor, "NoLegs");
    const legs = [{ venue: 0, path: v1Path([addr.whbar, addr.sauce]), amountIn: 1n, minOut: 0n }];
    await expect(exec(addr.whbar, addr.sauce, legs, 0n, { deadline: 1n })).to.be.revertedWithCustomError(
      executor,
      "Expired",
    );
    await expect(
      exec(addr.whbar, addr.sauce, legs, 0n, { recipient: ethers.ZeroAddress }),
    ).to.be.revertedWithCustomError(executor, "ZeroRecipient");
    await expect(exec(addr.whbar, addr.sauce, [{ ...legs[0]!, venue: 2 }], 0n))
      .to.be.revertedWithCustomError(executor, "BadVenue")
      .withArgs(2);
    await expect(
      exec(addr.whbar, addr.sauce, [{ venue: 0, path: v1Path([addr.whbar, addr.usdc]), amountIn: 1n, minOut: 0n }], 0n),
    )
      .to.be.revertedWithCustomError(executor, "PathMismatch")
      .withArgs(0);
    await expect(
      exec(
        addr.whbar,
        addr.sauce,
        [{ venue: 1, path: v2Path([addr.usdc, addr.sauce], [500]), amountIn: 1n, minOut: 0n }],
        0n,
      ),
    )
      .to.be.revertedWithCustomError(executor, "PathMismatch")
      .withArgs(0);
    await expect(exec(addr.whbar, addr.sauce, [{ venue: 1, path: "0x1234", amountIn: 1n, minOut: 0n }], 0n))
      .to.be.revertedWithCustomError(executor, "PathMismatch")
      .withArgs(0);
  });

  it("exposes immutable venue addresses and constants", async function () {
    expect(await executor.v1Router()).to.equal(await v1.getAddress());
    expect(await executor.v2Router()).to.equal(await v2.getAddress());
    expect(await executor.whbar()).to.equal(addr.whbar);
    expect(await executor.whbarHelper()).to.equal(await helper.getAddress());
    expect(await executor.HTS()).to.equal(HTS);
    expect(await executor.VENUE_V1()).to.equal(0);
    expect(await executor.VENUE_V2()).to.equal(1);
  });
});
