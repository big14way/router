import { describe, expect, it } from "vitest";
import { SDK_NAME } from "./index";

describe("router-sdk", () => {
  it("exports the package name", () => {
    expect(SDK_NAME).toBe("hedera-smart-order-router");
  });
});
