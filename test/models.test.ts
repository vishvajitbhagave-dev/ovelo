import { test } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_MODELS, DEFAULT_MODEL_ID, findAllowedModel, resolveModel } from "../agent/models";

/** Run `fn` with GEMINI_MODEL unset, then restore the previous value. */
function withoutGeminiModelEnv<T>(fn: () => T): T {
  const saved = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = saved;
  }
}

test("every allow-listed model id is accepted", () => {
  assert.ok(ALLOWED_MODELS.length > 0);
  for (const model of ALLOWED_MODELS) {
    assert.equal(findAllowedModel(model.id)?.id, model.id);
    assert.equal(resolveModel(model.id).id, model.id);
  }
});

test("unknown model ids are rejected, and lookup is case/space tolerant", () => {
  for (const bad of ["gpt-4o", "claude-3", "", "gemini-does-not-exist", null, undefined]) {
    assert.equal(findAllowedModel(bad), null);
  }
  const first = ALLOWED_MODELS[0].id;
  assert.equal(findAllowedModel(`  ${first.toUpperCase()}  `)?.id, first);
});

test("the default model is used when none is given (and GEMINI_MODEL is unset)", () => {
  withoutGeminiModelEnv(() => {
    assert.equal(DEFAULT_MODEL_ID, "gemini-flash-lite-latest");
    assert.equal(resolveModel().id, DEFAULT_MODEL_ID);
    assert.equal(resolveModel(undefined).id, DEFAULT_MODEL_ID);
    assert.equal(resolveModel(null).id, DEFAULT_MODEL_ID);
    assert.equal(resolveModel("").id, DEFAULT_MODEL_ID);
  });
});

test("an unknown requested id falls back to the default", () => {
  withoutGeminiModelEnv(() => {
    assert.equal(resolveModel("gpt-4o").id, DEFAULT_MODEL_ID);
    assert.equal(findAllowedModel("gpt-4o"), null);
  });
});

test("GEMINI_MODEL is used only when it is itself allow-listed", () => {
  const previous = process.env.GEMINI_MODEL;
  try {
    process.env.GEMINI_MODEL = "gemini-3.5-flash-lite";
    assert.equal(resolveModel().id, "gemini-3.5-flash-lite");
    assert.equal(resolveModel("gemini-3.6-flash").id, "gemini-3.6-flash", "explicit request wins");

    process.env.GEMINI_MODEL = "not-a-real-model";
    assert.equal(resolveModel().id, DEFAULT_MODEL_ID, "unknown env model falls back to default");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previous;
  }
});
