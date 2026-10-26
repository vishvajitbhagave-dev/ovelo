import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "../lib/clean-text";

test("removes asterisk-wrapped notes", () => {
  assert.equal(cleanText("*(Demo tickets only.)*"), "Demo tickets only.");
  assert.equal(cleanText("This is a demo *(not real)*."), "This is a demo not real.");
});

test("removes stray unmatched asterisks", () => {
  assert.equal(cleanText("**OV-1001"), "OV-1001");
  assert.equal(cleanText("Check **OV-1001** and *this*."), "Check **OV-1001** and this.");
});

test("keeps real bold text", () => {
  assert.equal(cleanText("**OV-1001** is HIGH risk."), "**OV-1001** is HIGH risk.");
});

test("keeps bullet lists", () => {
  assert.equal(cleanText("* first\n* second"), "* first\n* second");
  assert.equal(cleanText("- first\n- second"), "- first\n- second");
});

test("leaves prices and plain text unchanged", () => {
  const plain = "The ticket is valid. Price: $190.";
  assert.equal(cleanText(plain), plain);
});

test("collapses extra blank lines but keeps one blank line", () => {
  assert.equal(cleanText("A\n\n\n\nB"), "A\n\nB");
  assert.equal(cleanText("A\n\nB"), "A\n\nB");
});

test("keeps bold and removes a wrapped note in the same answer", () => {
  assert.equal(cleanText("**OV-1001** *(demo)*"), "**OV-1001** demo");
});

test("keeps inline code unchanged", () => {
  assert.equal(cleanText("Use `OV-1001*` here."), "Use `OV-1001*` here.");
});

test("returns an empty string for empty input", () => {
  assert.equal(cleanText(""), "");
});
