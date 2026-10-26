import { test } from "node:test";
import assert from "node:assert/strict";
import {
  friendlyError,
  GENERIC_ERROR_MESSAGE,
  SETTLE_FAILED_MESSAGE,
} from "../lib/friendly-errors";

test("turns a settle failure into a plain message", () => {
  const raw =
    'The x402 payment was not settled (settle_failed). {"error":"transaction reverted"}';
  const result = friendlyError(raw);
  assert.equal(result.message, SETTLE_FAILED_MESSAGE);
  assert.equal(result.technical, raw);
});

test("treats a second settle attempt as the same friendly failure", () => {
  const raw =
    "The x402 payment was not settled (settle_failed). Tried twice; the second attempt failed too.";
  const result = friendlyError(raw);
  assert.equal(result.message, SETTLE_FAILED_MESSAGE);
  assert.equal(result.technical, raw);
});

test("keeps existing friendly limit messages unchanged", () => {
  const messages = [
    "You have reached the chat limit for now. Please wait a few minutes and try again.",
    "You have used your paid reports for now. Please try again in a few minutes.",
    "Paid call limit reached, try again later. (at most 10 paid calls per hour)",
  ];

  for (const message of messages) {
    const result = friendlyError(message);
    assert.equal(result.message, message);
    assert.equal(result.technical, message);
  }
});

test("turns an unknown technical error into a generic message", () => {
  const raw = "TypeError: fetch failed";
  const result = friendlyError(raw);
  assert.equal(result.message, GENERIC_ERROR_MESSAGE);
  assert.equal(result.technical, raw);
});

test("keeps an already-plain setup error unchanged", () => {
  const raw = "Could not reach the server. Check your connection and try again.";
  const result = friendlyError(raw);
  assert.equal(result.message, raw);
  assert.equal(result.technical, raw);
});

test("uses the Error message as the raw technical detail", () => {
  const result = friendlyError(new Error("ECONNREFUSED 127.0.0.1"));
  assert.equal(result.message, GENERIC_ERROR_MESSAGE);
  assert.equal(result.technical, "ECONNREFUSED 127.0.0.1");
});
