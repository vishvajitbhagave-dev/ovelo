import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLatexArrows } from "../lib/latex-arrows";

test("converts common LaTeX right arrows to plain arrows", () => {
  assert.equal(convertLatexArrows("OV-1001 $\\rightarrow$ OV-1002"), "OV-1001 → OV-1002");
  assert.equal(convertLatexArrows("OV-1001 $\\to$ OV-1002"), "OV-1001 → OV-1002");
  assert.equal(convertLatexArrows("OV-1001 \\rightarrow OV-1002"), "OV-1001 → OV-1002");
});

test("converts common LaTeX left arrows to plain arrows", () => {
  assert.equal(convertLatexArrows("OV-1002 $\\leftarrow$ OV-1001"), "OV-1002 ← OV-1001");
});

test("leaves plain text and dollar prices unchanged", () => {
  const plain = "Check ticket OV-1001 -> scan -> report. Price: $190.";
  assert.equal(convertLatexArrows(plain), plain);
  assert.equal(convertLatexArrows("Price is $190, not $1.90."), "Price is $190, not $1.90.");
});
