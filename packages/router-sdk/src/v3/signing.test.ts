import { describe, expect, it } from "vitest";
import { hashTypedData, keccak256, toBytes, toHex, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  canonicalOrderText,
  extractOrder,
  hederaPersonalSignBytes,
  orderDigest,
  personalSignPayload,
  signChallenge,
  signOrderEcdsa,
  signOrderEd25519,
  signatureMapMode01,
  typedDataFor,
  V3_ORDER_TYPES,
  type V3Domain,
  type V3Order,
} from "./signing";

const domain: V3Domain = {
  name: "PartialFillLimitOrderReactor",
  version: "1",
  chainId: 296,
  verifyingContract: "0x5707B946EE64bD750A587261Ce36ec7024F3088B",
};
const order: V3Order = {
  info: {
    reactor: domain.verifyingContract,
    swapper: "0xf334EBBF2A14108C324E22aEc7b421A87Aae6039",
    nonce: "123456789",
    deadline: "1800000000",
    additionalValidationContract: "0x0000000000000000000000000000000000000000",
    additionalValidationData: "0x",
  },
  input: { token: "0x0000000000000000000000000000000000001549", amount: "1000000" },
  output: {
    token: "0x0000000000000000000000000000000000120f46",
    amount: "1000000000",
    recipient: "0xf334EBBF2A14108C324E22aEc7b421A87Aae6039",
  },
  makerOnly: false,
  takerOnce: true,
  maxTakerFeePips: 2000,
  maxMakerFeePips: 2000,
};
const PK = `0x${"11".repeat(32)}` as const;

describe("V3 signing", () => {
  it("extracts the EIP-712 fields from an API order object and rejects incomplete ones", () => {
    const raw = { order: { ...order, meta: { id: 1, status: "OPEN" } }, something: "else" };
    expect(extractOrder(raw)).toEqual(order);
    expect(extractOrder({ ...order, meta: {} } as unknown as Record<string, unknown>)).toEqual(order);
    expect(() => extractOrder({ info: {} })).toThrow(/info.reactor/);
  });

  it("hashes with the reactor's type definitions (sorted referenced types) and is deterministic", () => {
    const d = orderDigest(domain, order);
    expect(d).toMatch(/^0x[0-9a-f]{64}$/);
    expect(d).toBe(hashTypedData(typedDataFor(domain, order)));
    expect(orderDigest(domain, { ...order, info: { ...order.info, nonce: "1" } })).not.toBe(d);
    expect(Object.keys(V3_ORDER_TYPES)).toEqual([
      "PartialFillLimitOrder",
      "OrderInfo",
      "PartialFillInputToken",
      "OutputToken",
    ]);
    // type string must match the reactor's ORDER_TYPE (hash of the encoded type)
    const typeString =
      "PartialFillLimitOrder(OrderInfo info,PartialFillInputToken input,OutputToken output,bool makerOnly,bool takerOnce,uint32 maxTakerFeePips,uint32 maxMakerFeePips)OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)OutputToken(address token,uint256 amount,address recipient)PartialFillInputToken(address token,uint256 amount)";
    expect(keccak256(toHex(typeString))).toBe("0x" + expectedTypeHash());
  });

  it("signs mode 0x00 with ECDSA (recoverable) and ED25519 (64 bytes over the digest)", async () => {
    const sig = await signOrderEcdsa(PK, domain, order);
    expect(sig.startsWith("0x00")).toBe(true);
    expect(sig.length).toBe(2 + 2 + 130);
    const inner = `0x${sig.slice(4)}` as `0x${string}`;
    expect(
      await verifyTypedData({
        ...typedDataFor(domain, order),
        signature: inner,
        address: privateKeyToAccount(PK).address,
      }),
    ).toBe(true);
    const seen: Uint8Array[] = [];
    const ed = await signOrderEd25519(
      b => {
        seen.push(b);
        return new Uint8Array(64).fill(7);
      },
      domain,
      order,
    );
    expect(ed).toBe(`0x00${"07".repeat(64)}`);
    expect(toHex(seen[0]!)).toBe(orderDigest(domain, order));
    await expect(signOrderEd25519(() => new Uint8Array(65), domain, order)).rejects.toThrow(/64 bytes/);
  });

  it("renders the canonical personal-sign text and HIP-820 bytes exactly like the reactor", () => {
    const text = canonicalOrderText(order, domain.verifyingContract, domain.chainId);
    expect(text.split("\n")).toEqual([
      "Saucerswap PartialFillLimitOrder: confirm signed order",
      "Signing Format: Saucerswap PartialFillLimitOrder HederaPersonalSign v1",
      "Domain:         Saucerswap PartialFillLimitOrder",
      "Network:        chain 296",
      "Reactor:        0x5707b946ee64bd750a587261ce36ec7024f3088b",
      "---",
      "Swapper:        0xf334ebbf2a14108c324e22aec7b421a87aae6039",
      "Nonce:          123456789",
      "Deadline:       1800000000",
      "ValidationContract: 0x0000000000000000000000000000000000000000",
      `ValidationDataHash: ${keccak256(toBytes("0x"))}`,
      "---",
      "Input:          1000000 of 0x0000000000000000000000000000000000001549",
      "Output:         1000000000 of 0x0000000000000000000000000000000000120f46",
      "Recipient:      0xf334ebbf2a14108c324e22aec7b421a87aae6039",
      "---",
      "MakerOnly:      false",
      "TakerOnce:      true",
      "MaxTakerFee:    2000 pips",
      "MaxMakerFee:    2000 pips",
    ]);
    const bytes = hederaPersonalSignBytes("abc");
    expect(new TextDecoder().decode(bytes)).toBe("\x19Hedera Signed Message:\n3abc");
    expect(hederaPersonalSignBytes("é").length).toBe("\x19Hedera Signed Message:\n2".length + 2); // byte length, not char count
    expect(personalSignPayload(order, domain).bytes.length).toBe(
      new TextEncoder().encode(text).length +
        "\x19Hedera Signed Message:\n".length +
        String(new TextEncoder().encode(text).length).length,
    );
  });

  it("wraps signatures in a HIP-632 SignatureMap with the 0x01 mode byte", async () => {
    const sig = new Uint8Array(64).fill(1);
    const pub = new Uint8Array(32).fill(2);
    const wrapped = await signatureMapMode01([{ publicKey: pub, signature: sig, keyType: "ED25519" }]);
    expect(wrapped.startsWith("0x01")).toBe(true);
    const { proto } = await import("@hiero-ledger/proto");
    const decoded = proto.SignatureMap.decode(toBytes(`0x${wrapped.slice(4)}`));
    expect(decoded.sigPair).toHaveLength(1);
    expect(Buffer.from(decoded.sigPair[0]!.ed25519 as Uint8Array)).toEqual(Buffer.from(sig));
    const ecdsa = await signatureMapMode01([{ publicKey: pub, signature: sig, keyType: "ECDSA_SECP256K1" }]);
    expect(proto.SignatureMap.decode(toBytes(`0x${ecdsa.slice(4)}`)).sigPair[0]!.ECDSASecp256k1).toBeTruthy();
    expect(await signatureMapMode01({ encodedMap: new Uint8Array([9, 9]) })).toBe("0x010909");
  });

  it("signs the auth challenge over the Hedera personal-sign bytes", async () => {
    let seen = "";
    const sig = await signChallenge("Sign this message from SaucerSwap. Nonce: abc", b => {
      seen = new TextDecoder().decode(b);
      return new Uint8Array([0xab, 0xcd]);
    });
    expect(seen).toBe("\x19Hedera Signed Message:\n45Sign this message from SaucerSwap. Nonce: abc");
    expect(sig).toBe("0xabcd");
  });
});

function expectedTypeHash(): string {
  // keccak256 of the reactor's ORDER_TYPE bytes, computed here so the assertion documents the exact string.
  return keccak256(
    toHex(
      "PartialFillLimitOrder(OrderInfo info,PartialFillInputToken input,OutputToken output,bool makerOnly,bool takerOnce,uint32 maxTakerFeePips,uint32 maxMakerFeePips)OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)OutputToken(address token,uint256 amount,address recipient)PartialFillInputToken(address token,uint256 amount)",
    ),
  ).slice(2);
}
