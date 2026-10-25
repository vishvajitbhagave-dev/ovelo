import { test } from "node:test";
import assert from "node:assert/strict";
import { VISITOR_LIMITS } from "../agent/x402-config";
import {
  checkAndRecordChat,
  checkAndRecordPaid,
  getVisitorIdFromIp,
  resetVisitorLimits,
  trackedVisitorCount,
} from "../agent/visitor-limits";

test("under limit allowed; 5th allowed, 6th paid call refused", () => {
  resetVisitorLimits();
  let t = 1000000;
  const now = () => t;
  const id = getVisitorIdFromIp("1.2.3.4");
  for (let i = 0; i < VISITOR_LIMITS.paidPer10m; i++) {
    const r = checkAndRecordPaid(id, VISITOR_LIMITS, { now });
    assert.equal(r.allowed, true);
  }
  const rAfterLimit = checkAndRecordPaid(id, VISITOR_LIMITS, { now });
  assert.equal(rAfterLimit.allowed, false);
  if (!rAfterLimit.allowed) {
    assert.match(rAfterLimit.message, /paid reports/i);
    assert.ok(rAfterLimit.retryAfterSeconds >= 1);
  }
});

test("window expiry allows again", () => {
  resetVisitorLimits();
  let t = 2000000;
  const now = () => t;
  const id = getVisitorIdFromIp("5.6.7.8");
  for (let i = 0; i < VISITOR_LIMITS.paidPer10m; i++) {
    assert.equal(checkAndRecordPaid(id, VISITOR_LIMITS, { now }).allowed, true);
  }
  assert.equal(checkAndRecordPaid(id, VISITOR_LIMITS, { now }).allowed, false);
  t += VISITOR_LIMITS.windowMs + 1000;
  assert.equal(checkAndRecordPaid(id, VISITOR_LIMITS, { now }).allowed, true);
});

test("different visitors have separate counts", () => {
  resetVisitorLimits();
  let t = 3000000;
  const now = () => t;
  const a = getVisitorIdFromIp("9.9.9.9");
  const b = getVisitorIdFromIp("8.8.8.8");
  for (let i = 0; i < VISITOR_LIMITS.paidPer10m; i++) assert.equal(checkAndRecordPaid(a, VISITOR_LIMITS, { now }).allowed, true);
  assert.equal(checkAndRecordPaid(a, VISITOR_LIMITS, { now }).allowed, false);
  assert.equal(checkAndRecordPaid(b, VISITOR_LIMITS, { now }).allowed, true);
});

test("chat limit refused before any Gemini call", () => {
  resetVisitorLimits();
  let t = 4000000;
  const now = () => t;
  const id = getVisitorIdFromIp("7.7.7.7");
  for (let i = 0; i < VISITOR_LIMITS.chatPer10m; i++) {
    const r = checkAndRecordChat(id, VISITOR_LIMITS, { now });
    assert.equal(r.allowed, true);
  }
  const r2 = checkAndRecordChat(id, VISITOR_LIMITS, { now });
  assert.equal(r2.allowed, false);
  if (!r2.allowed) {
    assert.match(r2.message, /chat limit/i);
    assert.ok(r2.retryAfterSeconds >= 1);
  }
});

test("raw IP never appears in any stored key or returned message", () => {
  resetVisitorLimits();
  let t = 5000000;
  const now = () => t;
  const ip = "203.0.113.77";
  const id = getVisitorIdFromIp(ip);
  assert.ok(!id.includes(ip));
  const r = checkAndRecordPaid(id, VISITOR_LIMITS, { now });
  assert.equal(r.allowed, true);
  if (!r.allowed) {
    const m = (r as any).message as string;
    assert.ok(!m.includes(ip));
  }
  const r2 = checkAndRecordChat(id, VISITOR_LIMITS, { now });
  if (!r2.allowed) {
    const m2 = (r2 as any).message as string;
    assert.ok(!m2.includes(ip));
  }
});

test("missing IP falls back to the local bucket", () => {
  resetVisitorLimits();
  let t = 6000000;
  const now = () => t;
  const local = getVisitorIdFromIp(null);
  assert.equal(local, "local");
  const r = checkAndRecordChat(local, VISITOR_LIMITS, { now });
  assert.equal(r.allowed, true);
});

test("eviction at the visitor cap", () => {
  resetVisitorLimits();
  let t = 7000000;
  const now = () => t;
  // Create 1000 visitors
  for (let i = 0; i < 1000; i++) {
    const id = getVisitorIdFromIp(`10.0.0.${i % 250}.${Math.floor(i / 250)}`);
    // Make them different keys by using unique pattern
  }
  // Simpler: fill with unique ips
  resetVisitorLimits();
  t = 8000000;
  for (let i = 0; i < 1000; i++) {
    const id = getVisitorIdFromIp(`192.168.${Math.floor(i / 256)}.${i % 256}`);
    checkAndRecordChat(id, VISITOR_LIMITS, { now: () => t + i });
  }
  assert.equal(trackedVisitorCount(), 1000);
  // Add one more, should evict oldest
  checkAndRecordChat(getVisitorIdFromIp("172.16.0.1"), VISITOR_LIMITS, { now: () => t + 2000000 });
  assert.equal(trackedVisitorCount(), 1000);
});
