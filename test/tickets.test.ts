import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessTicketRisk,
  findDemoTicket,
  DEMO_TICKETS,
  DEMO_TICKET_IDS,
  type RiskLevel,
  type TicketRisk,
} from "../agent/tickets";

const EXPECTED: { id: string; level: RiskLevel; score: number }[] = [
  { id: "OV-1001", level: "LOW", score: 0 },
  { id: "OV-1002", level: "HIGH", score: 100 },
  { id: "OV-1003", level: "HIGH", score: 140 },
  { id: "OV-1004", level: "HIGH", score: 70 },
  { id: "OV-1005", level: "HIGH", score: 80 },
  { id: "OV-1006", level: "MEDIUM", score: 65 },
];

const RECOMMENDATION: Record<string, TicketRisk["recommendation"]> = {
  LOW: "ok to proceed",
  MEDIUM: "ask the buyer to approve first",
  HIGH: "do not fund",
};

test("assessTicketRisk gives each demo ticket its expected level and score", () => {
  assert.equal(DEMO_TICKETS.length, 6);
  assert.deepEqual(DEMO_TICKET_IDS, EXPECTED.map((e) => e.id));

  for (const { id, level, score } of EXPECTED) {
    const ticket = findDemoTicket(id);
    assert.ok(ticket, `demo ticket ${id} should exist`);
    const risk = assessTicketRisk(ticket);
    assert.equal(risk.ticketId, id);
    assert.equal(risk.riskLevel, level, `${id} risk level`);
    assert.equal(risk.score, score, `${id} score`);
  }
});

test("reasons are never empty and the recommendation matches the level", () => {
  for (const { id, level } of EXPECTED) {
    const ticket = findDemoTicket(id);
    assert.ok(ticket);
    const risk = assessTicketRisk(ticket);
    assert.ok(Array.isArray(risk.reasons) && risk.reasons.length > 0, `${id} has reasons`);
    assert.ok(
      risk.reasons.every((r) => typeof r === "string" && r.trim() !== ""),
      `${id} reasons are non-empty strings`
    );
    assert.equal(risk.recommendation, RECOMMENDATION[level], `${id} recommendation`);
  }
});

test("the same ticket always scores the same (decision is not random)", () => {
  const a = assessTicketRisk(findDemoTicket("OV-1006")!);
  const b = assessTicketRisk(findDemoTicket("OV-1006")!);
  assert.deepEqual(a, b);
});

test("findDemoTicket is forgiving about case and spaces, and never throws on bad input", () => {
  assert.equal(findDemoTicket("OV-1001")?.id, "OV-1001");
  assert.equal(findDemoTicket(" ov-1002 ")?.id, "OV-1002");
  assert.equal(findDemoTicket("ov-1003")?.id, "OV-1003");

  for (const bad of ["", "   ", "OV-0000", "not a ticket", "OV-100"]) {
    assert.doesNotThrow(() => findDemoTicket(bad));
    assert.equal(findDemoTicket(bad), undefined, `"${bad}" should not match a ticket`);
  }
});
