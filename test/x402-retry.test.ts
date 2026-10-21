import { test } from "node:test";
import assert from "node:assert/strict";
import { payAndFetchOfficial, type PayDeps } from "../agent/x402";
import { X402 } from "../agent/x402-config";
import type { SettlementTransfer } from "../agent/x402-verify";

/**
 * Unit tests for the SAFE RETRY of failed x402 settlements.
 *
 * Everything here is fake: a fake wallet account, a fake fetch that speaks just
 * enough of the x402 wire protocol, a fake chain guard and a fake verifier. No
 * network, no RPC, no payment, no real transaction — nothing leaves the process.
 */

const PAYER = "0x865b100A911a0eEA2ef8781614EB1737526E7683";
const TX_OK = "0x" + "a".repeat(64);
const TX_OK_2 = "0x" + "b".repeat(64);
const SETTLE_REASON = "invalid_exact_evm_transaction_failed";

/** A fake payer account: the SDK only ever reads `address` and calls `signTypedData`. */
function fakeAccount() {
  return {
    address: PAYER,
    async signTypedData() {
      // A 65-byte hex signature is all the ExactEvmScheme needs to build a payload.
      return ("0x" + "1".repeat(130)) as `0x${string}`;
    },
  };
}

/** Base64-encode a header value exactly the way the SDK's safeBase64Encode does. */
function b64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/** The standard PAYMENT-REQUIRED object the paid routes advertise (flat wire shape). */
function paymentRequired() {
  return {
    x402Version: 2,
    resource: { url: "http://localhost/api/weather", description: "Ovelo demo API" },
    accepts: [
      {
        scheme: "exact",
        network: X402.network,
        amount: X402.priceBaseUnits,
        asset: X402.token,
        payTo: X402.payTo,
        maxTimeoutSeconds: X402.maxTimeoutSeconds,
        extra: { name: X402.tokenName, version: X402.tokenVersion },
      },
    ],
  };
}

type WireOutcome =
  | { kind: "settled"; transaction: string; amount?: string }
  | { kind: "settle_failed"; errorReason?: string }
  | { kind: "payment_required" }
  | { kind: "http_error"; status: number };

/**
 * A fake fetch that speaks the x402 two-step dance:
 *   request without PAYMENT-SIGNATURE -> 402 + PAYMENT-REQUIRED
 *   request with PAYMENT-SIGNATURE    -> the next scripted outcome
 * Each scripted outcome is consumed once, so retries see the next one.
 * It also counts requests so a test can prove how many attempts were made.
 */
function fakeFetch(script: WireOutcome[]) {
  const state = { requests: 0, armed: 0, signatures: [] as string[] };
  const fetchImpl: typeof fetch = async (input, init) => {
    state.requests += 1;
    // wrapFetchWithPayment passes a Request as `input` (with headers), not `init`.
    const headers = new Headers(
      input instanceof Request ? input.headers : ((init?.headers as HeadersInit) ?? {})
    );
    const signature = headers.get("PAYMENT-SIGNATURE");
    if (signature) {
      state.signatures.push(signature);
      const outcome = script[state.armed];
      state.armed += 1;
      if (!outcome) throw new Error("fake fetch ran out of scripted outcomes");
      if (outcome.kind === "settled") {
        return new Response(JSON.stringify({ ok: true, city: "Oslo" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": b64({
              success: true,
              transaction: outcome.transaction,
              network: X402.network,
              payer: PAYER,
              amount: outcome.amount ?? X402.priceBaseUnits,
            }),
          },
        });
      }
      if (outcome.kind === "settle_failed") {
        return new Response(JSON.stringify({}), {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-RESPONSE": b64({
              success: false,
              errorReason: outcome.errorReason ?? SETTLE_REASON,
              network: X402.network,
              payer: PAYER,
            }),
          },
        });
      }
      if (outcome.kind === "payment_required") {
        return new Response(JSON.stringify({ error: "Payment Required" }), {
          status: 402,
          headers: {
            "content-type": "application/json",
            "PAYMENT-REQUIRED": b64(paymentRequired()),
          },
        });
      }
      return new Response("nope", { status: outcome.status, headers: { "content-type": "text/plain" } });
    }

    // No payment header yet: the server asks for payment — unless the first
    // scripted outcome is a plain HTTP error, which must short-circuit before
    // any payment is even attempted.
    if (script[state.armed]?.kind === "http_error") {
      const outcome = script[state.armed];
      state.armed += 1;
      return new Response("nope", {
        status: (outcome as { status: number }).status,
        headers: { "content-type": "text/plain" },
      });
    }
    return new Response(JSON.stringify({ error: "Payment Required" }), {
      status: 402,
      headers: {
        "content-type": "application/json",
        "PAYMENT-REQUIRED": b64(paymentRequired()),
      },
    });
  };
  return { fetchImpl, state };
}

/** A fake verifier that always confirms, reporting the given block. */
const verifierOkay = async (hash: string) => ({
  verified: true as const,
  blockNumber: "48413342",
  from: PAYER,
  to: X402.payTo,
  value: X402.priceBaseUnits,
});

/** A fake guard that finds nothing. */
const guardEmpty = async (): Promise<SettlementTransfer | null> => null;

/** A fake guard that finds a matching transfer (money already moved). */
function guardFinds(tx = TX_OK): () => Promise<SettlementTransfer | null> {
  return async () => ({
    blockNumber: "48413500",
    transactionHash: tx,
    from: PAYER,
    to: X402.payTo,
    value: X402.priceBaseUnits,
  });
}

function deps(overrides: Partial<PayDeps> & { fetch: typeof fetch }): PayDeps {
  return {
    account: fakeAccount(),
    verify: verifierOkay as PayDeps["verify"],
    ...overrides,
  };
}

// ───────────────────────── 1. first attempt succeeds ─────────────────────────

test("no retry: a first-attempt success settles with exactly one payment attempt", async () => {
  const { fetchImpl, state } = fakeFetch([{ kind: "settled", transaction: TX_OK }]);
  const result = await payAndFetchOfficial("http://localhost/api/weather", deps({ fetch: fetchImpl }));

  assert.equal(state.armed, 1, "settled on the first signed attempt");
  assert.equal(state.requests, 2, "one unpaid 402 probe + one signed request");
  assert.equal(result.payment?.verified, true);
  assert.equal(result.payment?.txHash, TX_OK);
});

// ───────────────────────── 2. settle_failed then success ─────────────────────────

test("one retry: settle_failed then success stops after two attempts and returns verified", async () => {
  const { fetchImpl, state } = fakeFetch([
    { kind: "settle_failed", errorReason: SETTLE_REASON },
    { kind: "settled", transaction: TX_OK_2 },
  ]);
  let guardCalls = 0;
  const result = await payAndFetchOfficial(
    "http://localhost/api/weather",
    deps({
      fetch: fetchImpl,
      findTransfer: (async () => {
        guardCalls += 1;
        return null;
      }) as PayDeps["findTransfer"],
    })
  );

  assert.equal(state.armed, 2, "settled on the retry");
  assert.equal(guardCalls, 1, "the guard ran exactly once before retrying");
  assert.equal(state.signatures.length, 2, "two distinct authorizations were signed");
  assert.notEqual(state.signatures[0], state.signatures[1], "the retry signed a fresh payload");
  assert.equal(result.payment?.verified, true);
  assert.equal(result.payment?.txHash, TX_OK_2);
});

// ───────────────────────── 3. settle_failed twice ─────────────────────────

test("settle_failed twice stops at two attempts and throws naming the double try", async () => {
  const { fetchImpl, state } = fakeFetch([
    { kind: "settle_failed", errorReason: SETTLE_REASON },
    { kind: "settle_failed", errorReason: SETTLE_REASON },
  ]);
  await assert.rejects(
    () => payAndFetchOfficial("http://localhost/api/weather", deps({ fetch: fetchImpl, findTransfer: guardEmpty as PayDeps["findTransfer"] })),
    (err: Error) => {
      assert.match(err.message, /tried twice/i);
      assert.match(err.message, /invalid_exact_evm_transaction_failed/);
      return true;
    }
  );
  assert.equal(state.armed, 2, "never more than two settle attempts");
});

// ───────────────────────── 4. non-settle error: no retry ─────────────────────────

test("a payment_required outcome is never retried", async () => {
  const { fetchImpl, state } = fakeFetch([{ kind: "payment_required" }]);
  await assert.rejects(
    () => payAndFetchOfficial("http://localhost/api/weather", deps({ fetch: fetchImpl })),
    /not settled/i
  );
  assert.equal(state.armed, 1, "the payment_required outcome was consumed once and not retried");
});

test("a plain HTTP error response is not retried", async () => {
  const { fetchImpl, state } = fakeFetch([{ kind: "http_error", status: 500 }]);
  const result = await payAndFetchOfficial("http://localhost/api/weather", deps({ fetch: fetchImpl }));
  // A non-402 response is handed straight back: no payment, no signing, no retry.
  assert.equal(result.payment, undefined);
  assert.equal(state.requests, 1, "the response was read once and never retried");
  assert.equal(state.signatures.length, 0, "no signed attempt was ever made");
});

// ───────────────────────── 5. guard finds an existing transfer ─────────────────────────

test("the double-pay guard finds an existing Transfer and refuses to retry", async () => {
  const { fetchImpl, state } = fakeFetch([{ kind: "settle_failed", errorReason: SETTLE_REASON }]);
  const result = await payAndFetchOfficial(
    "http://localhost/api/weather",
    deps({ fetch: fetchImpl, findTransfer: guardFinds(TX_OK) as PayDeps["findTransfer"] })
  );

  assert.equal(state.armed, 1, "only the first failed attempt ran; no second attempt");
  assert.equal(result.payment?.verified, false, "paid but NOT verified");
  assert.equal(result.payment?.txHash, TX_OK, "points at the transfer the guard found");
  assert.match(result.payment?.verifyReason ?? "", /already exists on chain/i);
  assert.match(result.payment?.verifyReason ?? "", /not retrying/i);
});

test("a missing wallet fails before any request, with no retry", async () => {
  const { fetchImpl, state } = fakeFetch([{ kind: "settled", transaction: TX_OK }]);
  await assert.rejects(
    () =>
      payAndFetchOfficial("http://localhost/api/weather", {
        fetch: fetchImpl,
        account: null,
      }),
    /no wallet/i
  );
  assert.equal(state.requests, 0);
});
