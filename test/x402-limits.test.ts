import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  checkX402SpendLimit,
  resetX402SpendLimits,
  recordedPaidCalls,
  formatUsdcFloor,
  X402_LIMIT_MESSAGE,
} from "../agent/x402-limits";
import { X402 } from "../agent/x402-config";

/**
 * Unit tests for the agent's x402 SPEND GUARD.
 *
 * All fake: a fake clock and a fake balance read. No network, no RPC, no
 * payment — the guard is pure logic over an in-memory list of call times plus
 * one injected balance number.
 */

const PAYER = "0x865b100A911a0eEA2ef8781614EB1737526E7683";
const RICH = BigInt(X402.minAgentUsdcBaseUnits) + 1_000_000n; // comfortably above the floor
const POOR = BigInt(X402.minAgentUsdcBaseUnits) - 1n; // one base unit below the floor

/** A controllable clock for the rolling windows. */
function fakeClock(startMs = 1_000_000_000_000) {
  let now = startMs;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

/** Build the option bag the guard wants, with a fixed balance. */
function options(clock: ReturnType<typeof fakeClock>, balance: bigint) {
  return {
    payer: PAYER,
    now: clock.now,
    getUsdcBalance: async () => balance,
  };
}

beforeEach(() => {
  resetX402SpendLimits();
});

// ───────────────────────── under the limit: allowed ─────────────────────────

test("a first paid call with a healthy balance is allowed", async () => {
  const clock = fakeClock();
  const result = await checkX402SpendLimit(options(clock, RICH));
  assert.equal(result.allowed, true);
  assert.equal(recordedPaidCalls().length, 1, "the allowed call was counted");
});

test("calls up to the minute cap are allowed, and each is counted", async () => {
  const clock = fakeClock();
  for (let i = 0; i < X402.maxPaidCallsPerMinute; i++) {
    const result = await checkX402SpendLimit(options(clock, RICH));
    assert.equal(result.allowed, true, `call ${i + 1} should be allowed`);
  }
  assert.equal(recordedPaidCalls().length, X402.maxPaidCallsPerMinute);
});

// ───────────────────────── minute limit ─────────────────────────

test("the minute limit refuses the call after the cap, and counts nothing", async () => {
  const clock = fakeClock();
  for (let i = 0; i < X402.maxPaidCallsPerMinute; i++) {
    await checkX402SpendLimit(options(clock, RICH));
  }
  const refused = await checkX402SpendLimit(options(clock, RICH));

  assert.equal(refused.allowed, false);
  if (refused.allowed) return;
  assert.equal(refused.code, "MINUTE");
  assert.match(refused.message, /minute/i);
  assert.ok(refused.retryAfterSeconds && refused.retryAfterSeconds > 0, "says when to try again");
  assert.equal(
    recordedPaidCalls().length,
    X402.maxPaidCallsPerMinute,
    "the refused call did not consume budget"
  );
});

test("the minute window slides: a call is allowed again once the oldest minute-old call expires", async () => {
  const clock = fakeClock();
  for (let i = 0; i < X402.maxPaidCallsPerMinute; i++) {
    await checkX402SpendLimit(options(clock, RICH));
  }
  assert.equal((await checkX402SpendLimit(options(clock, RICH))).allowed, false);

  clock.advance(61_000); // one minute + a second
  const allowed = await checkX402SpendLimit(options(clock, RICH));
  assert.equal(allowed.allowed, true, "the minute window freed up");
});

// ───────────────────────── hour limit ─────────────────────────

test("the hour limit caps the total even when spread out to beat the minute limit", async () => {
  const clock = fakeClock();
  // Spend right up to the hour cap, taking one call every 5 minutes so the
  // minute limit never trips (10 calls < 12 five-minute slots in an hour).
  for (let i = 0; i < X402.maxPaidCallsPerHour; i++) {
    const result = await checkX402SpendLimit(options(clock, RICH));
    assert.equal(result.allowed, true, `hour call ${i + 1} should be allowed`);
    clock.advance(5 * 60 * 1000);
  }

  const refused = await checkX402SpendLimit(options(clock, RICH));
  assert.equal(refused.allowed, false);
  if (refused.allowed) return;
  assert.equal(refused.code, "HOUR");
  assert.match(refused.message, /hour/i);
  assert.equal(recordedPaidCalls().length, X402.maxPaidCallsPerHour);
});

test("the hour window slides: the cap frees up once the oldest hour-old call expires", async () => {
  const clock = fakeClock();
  for (let i = 0; i < X402.maxPaidCallsPerHour; i++) {
    await checkX402SpendLimit(options(clock, RICH));
    clock.advance(5 * 60 * 1000);
  }
  assert.equal((await checkX402SpendLimit(options(clock, RICH))).allowed, false);

  clock.advance(31 * 60 * 1000); // push the oldest call past the one-hour line
  const allowed = await checkX402SpendLimit(options(clock, RICH));
  assert.equal(allowed.allowed, true, "the hour window freed up");
});

// ───────────────────────── low balance ─────────────────────────

test("a wallet below the USDC floor is refused, even with no recent calls", async () => {
  const clock = fakeClock();
  const refused = await checkX402SpendLimit(options(clock, POOR));

  assert.equal(refused.allowed, false);
  if (refused.allowed) return;
  assert.equal(refused.code, "LOW_BALANCE");
  assert.match(refused.message, /USDC/i);
  assert.equal(recordedPaidCalls().length, 0, "nothing was counted");
});

test("an unreadable balance is refused (spending blind is the risk we guard)", async () => {
  const clock = fakeClock();
  const refused = await checkX402SpendLimit({
    payer: PAYER,
    now: clock.now,
    getUsdcBalance: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(refused.allowed, false);
  if (refused.allowed) return;
  assert.equal(refused.code, "LOW_BALANCE");
});

// ───────────────────────── message + helper ─────────────────────────

test("every refusal opens with the same honest sentence", async () => {
  const clock = fakeClock();
  for (let i = 0; i < X402.maxPaidCallsPerMinute; i++) {
    await checkX402SpendLimit(options(clock, RICH));
  }
  const minute = await checkX402SpendLimit(options(clock, RICH));
  const poor = await checkX402SpendLimit(options(fakeClock(2_000_000_000_000), POOR));
  if (!minute.allowed) assert.ok(minute.message.startsWith(X402_LIMIT_MESSAGE));
  if (!poor.allowed) assert.ok(poor.message.startsWith(X402_LIMIT_MESSAGE));
});

test("formatUsdcFloor renders base units as a USDC label", () => {
  assert.equal(formatUsdcFloor(500000n), "0.5 USDC");
  assert.equal(formatUsdcFloor(1000000n), "1 USDC");
  assert.equal(formatUsdcFloor(1500000n), "1.5 USDC");
});
