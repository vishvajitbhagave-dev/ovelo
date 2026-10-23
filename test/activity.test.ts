import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActivityEvent, activityFromSteps } from "../lib/activity";

test("makeActivityEvent stamps an id and time, and keeps a supplied time", () => {
  const event = makeActivityEvent({ title: "Checked OV-1001", outcome: "done" });
  assert.equal(event.title, "Checked OV-1001");
  assert.equal(event.outcome, "done");
  assert.ok(event.id && event.id.length > 0);
  assert.ok(!Number.isNaN(Date.parse(event.at)), "at is an ISO timestamp");

  const fixed = makeActivityEvent({ title: "x", outcome: "done", at: "2020-01-01T00:00:00.000Z" });
  assert.equal(fixed.at, "2020-01-01T00:00:00.000Z");
});

test("activityFromSteps ignores missing/unknown steps", () => {
  assert.deepEqual(activityFromSteps(undefined), []);
  assert.deepEqual(activityFromSteps([]), []);
  assert.deepEqual(activityFromSteps([{ tool: "get_my_wallet" }]), []);
});

test("a VERIFIED paid history report becomes a 'done' event settled on-chain", () => {
  const events = activityFromSteps([
    {
      tool: "get_ticket_history_report",
      result: {
        payment: {
          amount: "0.01 USDC",
          to: "0xDc672f03ec6226B31E45347402af077eCb595559",
          txHash: "0xabc",
          url: "https://sepolia.basescan.org/tx/0xabc",
          verified: true,
          blockNumber: "48404488",
        },
        data: { ticket: { id: "OV-1002" } },
      },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "done");
  assert.equal(events[0].amount, "0.01");
  assert.equal(events[0].ticketId, "OV-1002");
  assert.equal(events[0].amountNote, "settled on-chain via x402 · block 48404488");
  assert.equal(events[0].verified, true);
  assert.equal(events[0].blockNumber, "48404488");
  assert.equal(events[0].counterparty, "apiOwner");
  assert.equal(events[0].counterpartyAddress, "0xDc672f03ec6226B31E45347402af077eCb595559");
  assert.equal(events[0].hash, "0xabc");
  assert.equal(events[0].url, "https://sepolia.basescan.org/tx/0xabc");
});

test("an UNVERIFIED paid report is logged honestly, never as settled on-chain", () => {
  const events = activityFromSteps([
    {
      tool: "get_ticket_history_report",
      result: {
        payment: {
          amount: "0.01 USDC",
          to: "0xDc672f03ec6226B31E45347402af077eCb595559",
          txHash: "0xabc",
          url: "https://sepolia.basescan.org/tx/0xabc",
          verified: false,
          verifyReason: "the transaction receipt was not readable yet.",
        },
        data: { ticket: { id: "OV-1002" } },
      },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, "0.01");
  assert.equal(events[0].verified, false);
  assert.equal(events[0].blockNumber, undefined);
  assert.equal(events[0].amountNote, "paid — facilitator reported success but not verified on-chain");
  assert.ok(!String(events[0].amountNote).includes("settled on-chain"));
});

test("a paid report with a hash but no verified flag is NOT claimed as settled", () => {
  const events = activityFromSteps([
    {
      tool: "get_ticket_history_report",
      result: {
        payment: { amount: "0.01 USDC", txHash: "0xabc", url: "https://sepolia.basescan.org/tx/0xabc" },
      },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].verified, false);
  assert.equal(events[0].amountNote, "paid — facilitator reported success but not verified on-chain");
});

test("a paid report with no settlement details still logs the amount alone", () => {
  const events = activityFromSteps([
    { tool: "get_ticket_history_report", result: { payment: { amount: "0.01 USDC" } } },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].amount, "0.01");
  assert.equal(events[0].amountNote, undefined);
  assert.equal(events[0].hash, undefined);
  assert.equal(events[0].url, undefined);
  assert.equal(events[0].counterpartyAddress, undefined);
});

test("a REUSED report is logged as no new payment, with the original transaction", () => {
  const events = activityFromSteps([
    {
      tool: "get_ticket_history_report",
      result: {
        reused: true,
        reusedFromTxHash: "0xabc",
        blockNumber: "48404488",
        ageSeconds: 120,
        payment: {
          amount: "0.01 USDC",
          to: "0xDc672f03ec6226B31E45347402af077eCb595559",
          txHash: "0xabc",
          url: "https://sepolia.basescan.org/tx/0xabc",
          verified: true,
          blockNumber: "48404488",
        },
        data: { ticket: { id: "OV-1002" } },
      },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].reused, true);
  assert.equal(events[0].title, "Reused report (no new payment) for OV-1002");
  assert.equal(events[0].amount, undefined);
  assert.equal(events[0].amountNote, "original payment settled on-chain · block 48404488");
  assert.equal(events[0].verified, true);
  assert.equal(events[0].blockNumber, "48404488");
  assert.equal(events[0].hash, "0xabc");
  assert.equal(events[0].url, "https://sepolia.basescan.org/tx/0xabc");
});

test("a REUSED unverified report keeps the unverified flag and never claims settlement", () => {
  const events = activityFromSteps([
    {
      tool: "get_ticket_history_report",
      result: {
        reused: true,
        reusedFromTxHash: "0xunverified",
        payment: {
          amount: "0.01 USDC",
          txHash: "0xunverified",
          url: "https://sepolia.basescan.org/tx/0xunverified",
          verified: false,
          verifyReason: "not readable yet",
        },
        data: { ticket: { id: "OV-1002" } },
      },
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].reused, true);
  assert.equal(events[0].amount, undefined);
  assert.equal(events[0].verified, false);
  assert.equal(events[0].blockNumber, undefined);
  assert.equal(events[0].amountNote, "original payment — not verified on-chain");
  assert.ok(!String(events[0].amountNote).includes("settled on-chain"));
});

test("a HIGH risk check becomes a check event plus a refused event", () => {
  const events = activityFromSteps([
    { tool: "check_ticket_risk", result: { found: true, ticketId: "OV-1002", riskLevel: "HIGH", score: 100, reasons: ["dup"] } },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[0].outcome, "done");
  assert.equal(events[1].outcome, "refused");
  assert.equal(events[1].ticketId, "OV-1002");
});

test("a MEDIUM risk check becomes a check event plus a waiting event", () => {
  const events = activityFromSteps([
    { tool: "check_ticket_risk", result: { found: true, ticketId: "OV-1006", riskLevel: "MEDIUM", score: 65, reasons: ["r"] } },
  ]);
  assert.equal(events.length, 2);
  assert.equal(events[1].outcome, "waiting");
});

test("funding outcomes map to done, waiting or refused", () => {
  const ok = activityFromSteps([
    { tool: "fund_escrow", result: { ok: true, ticketId: "OV-1001", links: [{ kind: "fund", hash: "0xhash", url: "https://x/tx/0xhash" }] } },
  ]);
  assert.equal(ok.length, 1);
  assert.equal(ok[0].outcome, "done");
  assert.equal(ok[0].amount, "1");
  assert.equal(ok[0].counterparty, "escrow");
  assert.equal(ok[0].hash, "0xhash");

  const medium = activityFromSteps([{ tool: "fund_escrow", result: { ok: false, riskLevel: "MEDIUM", ticketId: "OV-1006" } }]);
  assert.equal(medium[0].outcome, "waiting");

  const refused = activityFromSteps([{ tool: "fund_escrow", result: { ok: false, ticketId: "OV-1002", message: "refused" } }]);
  assert.equal(refused[0].outcome, "refused");
});
