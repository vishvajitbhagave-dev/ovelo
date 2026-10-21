import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUsdcLabel, extractSettlement } from "../agent/x402";

test("formatUsdcLabel turns atomic units into the legacy '0.01 USDC' label", () => {
  assert.equal(formatUsdcLabel("10000", "0.01"), "0.01 USDC");
  assert.equal(formatUsdcLabel("1000000", "0.01"), "1 USDC");
  assert.equal(formatUsdcLabel("1", "0.01"), "0.000001 USDC");
  assert.equal(formatUsdcLabel("12345678", "0.01"), "12.345678 USDC");
  assert.equal(formatUsdcLabel("0", "0.01"), "0 USDC");
});

test("formatUsdcLabel falls back to the advertised price when the amount is missing or junk", () => {
  assert.equal(formatUsdcLabel(undefined, "0.01"), "0.01 USDC");
  assert.equal(formatUsdcLabel(null, "0.01"), "0.01 USDC");
  assert.equal(formatUsdcLabel("", "0.01"), "0.01 USDC");
  assert.equal(formatUsdcLabel("not-a-number", "0.01"), "0.01 USDC");
  assert.equal(formatUsdcLabel("-5", "0.01"), "0.01 USDC");
});

test("extractSettlement normalizes a full PAYMENT-RESPONSE header", () => {
  const settlement = extractSettlement({
    success: true,
    transaction: "0xabc123",
    network: "eip155:84532",
    payer: "0x865b100A911a0eEA2ef8781614EB1737526E7683",
  });
  assert.deepEqual(settlement, {
    success: true,
    transaction: "0xabc123",
    network: "eip155:84532",
    payer: "0x865b100A911a0eEA2ef8781614EB1737526E7683",
  });
});

test("extractSettlement drops an absent payer and never invents a transaction", () => {
  const settlement = extractSettlement({ success: true, transaction: "0xabc", network: "eip155:84532" });
  assert.deepEqual(settlement, { success: true, transaction: "0xabc", network: "eip155:84532" });
  assert.ok(settlement && !("payer" in settlement));

  assert.equal(extractSettlement(null), null);
  assert.equal(extractSettlement(undefined), null);
  assert.equal(extractSettlement({ success: true }), null);
  assert.equal(extractSettlement({ success: true, transaction: "" }), null);
  assert.equal(extractSettlement({ success: false, transaction: "0xabc" })?.success, false);
});
