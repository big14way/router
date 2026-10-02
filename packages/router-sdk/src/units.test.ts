import { describe, expect, it } from "vitest";
import {
  addressToEntity,
  applyBps,
  entityToAddress,
  formatUnits,
  fromTinybar,
  isLongZero,
  minusBps,
  parseUnits,
  tinybarToWeibar,
  toTinybar,
  weibarToTinybar,
} from "./units";

describe("units: HBAR 8 decimals", () => {
  it("parses whole and fractional HBAR into tinybar", () => {
    expect(toTinybar("1")).toBe(100_000_000n);
    expect(toTinybar("0.00000001")).toBe(1n);
    expect(toTinybar(10)).toBe(1_000_000_000n);
    expect(toTinybar("12.5")).toBe(1_250_000_000n);
  });

  it("rejects more than 8 fractional digits and junk", () => {
    expect(() => toTinybar("0.000000001")).toThrow(/decimals/);
    expect(() => toTinybar("abc")).toThrow(/invalid/);
    expect(() => toTinybar("")).toThrow(/invalid/);
    expect(() => toTinybar(".")).toThrow(/invalid/);
  });

  it("formats tinybar back without trailing zeros", () => {
    expect(fromTinybar(100_000_000n)).toBe("1");
    expect(fromTinybar(1_250_000_000n)).toBe("12.5");
    expect(fromTinybar(1n)).toBe("0.00000001");
    expect(formatUnits(-1_500_000n, 6)).toBe("-1.5");
    expect(formatUnits(0n, 6)).toBe("0");
  });

  it("round-trips parse/format for token decimals", () => {
    for (const [amt, dec] of [
      ["0.000001", 6],
      ["123456.789", 6],
      ["1", 18],
      ["0.5", 8],
    ] as const) {
      expect(formatUnits(parseUnits(amt, dec), dec)).toBe(amt);
    }
  });

  it("converts tinybar <-> weibar at 1e10 (JSON-RPC relay)", () => {
    expect(tinybarToWeibar(1n)).toBe(10_000_000_000n);
    expect(tinybarToWeibar(toTinybar("1"))).toBe(10n ** 18n);
    expect(weibarToTinybar(10n ** 18n)).toBe(100_000_000n);
    expect(weibarToTinybar(10n ** 18n + 5n)).toBe(100_000_000n);
  });

  it("applies basis points", () => {
    expect(applyBps(10_000n, 50)).toBe(50n);
    expect(minusBps(1_000_000n, 100)).toBe(990_000n);
    expect(minusBps(1_000_000n, 0)).toBe(1_000_000n);
  });
});

describe("units: Hedera entity <-> long-zero address", () => {
  it("maps 0.0.n to a checksummed long-zero address and back", () => {
    expect(entityToAddress("0.0.15058")).toBe("0x0000000000000000000000000000000000003aD2");
    expect(entityToAddress("0.0.19264")).toBe("0x0000000000000000000000000000000000004b40");
    expect(addressToEntity("0x0000000000000000000000000000000000003ad2")).toBe("0.0.15058");
    expect(addressToEntity(entityToAddress("0.0.5449"))).toBe("0.0.5449");
  });

  it("rejects bad ids and alias addresses", () => {
    expect(() => entityToAddress("15058")).toThrow(/invalid/);
    expect(() => entityToAddress("1.0.5")).toThrow(/shard/);
    expect(() => addressToEntity("0xca367694cdac8f152e33683bb36cc9d6a73f1ef2")).toThrow(/long-zero/);
    expect(() => addressToEntity("0x1234")).toThrow(/invalid/);
    expect(isLongZero("0xca367694cdac8f152e33683bb36cc9d6a73f1ef2")).toBe(false);
    expect(isLongZero("0x0000000000000000000000000000000000003ad2")).toBe(true);
  });
});
