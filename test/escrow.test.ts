import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runIdFor,
  ticketKeyFor,
  isKnownTicket,
  evaluateFundingPolicy,
  makeRunId,
  DEAL_STATUS,
} from "../agent/escrow";
import { ESCROW, BASESCAN } from "../agent/escrow-config";

const HIGH_TICKETS = ["OV-1002", "OV-1003", "OV-1004", "OV-1005"];
const MEDIUM_TICKET = "OV-1006";
const LOW_TICKET = "OV-1001";

test("runIdFor is stable inside one funding window and changes across windows or tickets", () => {
  const windowMs = ESCROW.fundingWindowSeconds * 1000;
  const base = windowMs * 1000; // an exact window boundary

  const same = runIdFor(LOW_TICKET, base);
  assert.equal(same, runIdFor(LOW_TICKET, base + windowMs - 1), "same bucket -> same id");
  assert.match(same, /^[0-9a-f]{8}$/, "run id is 8 hex chars");

  assert.notEqual(same, runIdFor(LOW_TICKET, base + windowMs), "next bucket -> different id");
  assert.notEqual(same, runIdFor("OV-1002", base), "different ticket -> different id");
});

test("ticketKeyFor is a deterministic 32-byte hash of ticketId + runId", () => {
  const key = ticketKeyFor(LOW_TICKET, "abcd1234");
  assert.match(key, /^0x[0-9a-f]{64}$/i);
  assert.equal(key, ticketKeyFor(LOW_TICKET, "abcd1234"));
  assert.notEqual(key, ticketKeyFor(LOW_TICKET, "abcd9999"));
  assert.notEqual(key, ticketKeyFor("OV-1002", "abcd1234"));
});

test("isKnownTicket recognises demo ids (case/space tolerant) and rejects unknown ones", () => {
  assert.equal(isKnownTicket("OV-1001"), true);
  assert.equal(isKnownTicket(" ov-1002 "), true);
  assert.equal(isKnownTicket("OV-9999"), false);
  assert.equal(isKnownTicket(""), false);
  assert.doesNotThrow(() => isKnownTicket("garbage"));
});

test("funding policy: LOW allowed, MEDIUM only when approved, HIGH always refused", () => {
  assert.equal(evaluateFundingPolicy(LOW_TICKET, false).allow, true);
  assert.equal(evaluateFundingPolicy(LOW_TICKET, true).allow, true);

  const mediumUnapproved = evaluateFundingPolicy(MEDIUM_TICKET, false);
  assert.equal(mediumUnapproved.allow, false);
  assert.equal(mediumUnapproved.code, "MEDIUM");
  assert.equal(evaluateFundingPolicy(MEDIUM_TICKET, true).allow, true);

  for (const id of HIGH_TICKETS) {
    for (const approved of [false, true]) {
      const decision = evaluateFundingPolicy(id, approved);
      assert.equal(decision.allow, false, `${id} approved=${approved} must be refused`);
      assert.equal(decision.code, "HIGH");
      assert.equal(decision.risk?.riskLevel, "HIGH");
      assert.ok(decision.message.trim() !== "");
    }
  }
});

test("funding policy: an unknown ticket is refused with UNKNOWN_TICKET", () => {
  const decision = evaluateFundingPolicy("OV-0000", true);
  assert.equal(decision.allow, false);
  assert.equal(decision.code, "UNKNOWN_TICKET");
  assert.equal(decision.risk, null);
  assert.ok(decision.message.trim() !== "");
});

test("a demo deal is always exactly 1 USDC", () => {
  assert.equal(ESCROW.tokenDecimals, 6);
  const whole = Number(ESCROW.demoAmountBaseUnits) / 10 ** ESCROW.tokenDecimals;
  assert.equal(whole, 1);
  assert.ok(Number.isInteger(Number(ESCROW.demoAmountBaseUnits)));
});

test("guard thresholds are the expected pure config values", () => {
  // These are the constants the guards in fundEscrow compare against.
  // The comparisons themselves run next to chain reads and are not unit-tested here.
  assert.equal(ESCROW.cooldownSeconds, 20);
  assert.equal(ESCROW.maxTotalDeals, 40);
  assert.equal(ESCROW.deadlineSeconds, 3600);
  assert.equal(ESCROW.fundingWindowSeconds, 600);
  assert.equal(ESCROW.minAgentEthWei, "300000000000000");
  assert.equal(ESCROW.minAgentUsdcBaseUnits, "3000000");
  assert.equal(BigInt(ESCROW.minAgentUsdcBaseUnits) / 10n ** 6n, 3n, "USDC floor is 3");
});

test("DEAL_STATUS maps the contract's status numbers in order", () => {
  assert.deepEqual(DEAL_STATUS, { 0: "None", 1: "Funded", 2: "Released", 3: "Refunded" });
});

test("makeRunId returns a fresh 8-hex-char id each call", () => {
  const a = makeRunId();
  const b = makeRunId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.match(b, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test("BASESCAN helpers build the expected explorer links", () => {
  assert.equal(BASESCAN.tx("0xabc"), `${ESCROW.explorer}/tx/0xabc`);
  assert.equal(BASESCAN.address("0xdef"), `${ESCROW.explorer}/address/0xdef`);
  assert.equal(ESCROW.chainId, 84532);
});
