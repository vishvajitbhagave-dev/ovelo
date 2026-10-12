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

test("a paid history report becomes a 'done' event with the parsed amount", () => {
  const events = activityFromSteps([
    {
      tool: "get_ticket_history_report",
      result: { payment: { amount: "0.01 USDC" }, data: { ticket: { id: "OV-1002" } } },
    },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].outcome, "done");
  assert.equal(events[0].amount, "0.01");
  assert.equal(events[0].ticketId, "OV-1002");
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
