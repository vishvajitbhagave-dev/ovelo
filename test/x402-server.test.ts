import { test } from "node:test";
import assert from "node:assert/strict";
import { paidRoute, payerFromRequest } from "../agent/x402-server";
import { X402 } from "../agent/x402-config";

/** The unpaid-body callback takes a request context our route config ignores. */
type UnpaidContext = Parameters<NonNullable<ReturnType<typeof paidRoute>["unpaidResponseBody"]>>[0];

test("paidRoute advertises one price, one recipient, one network and a 60s window", () => {
  const route = paidRoute("Ovelo demo API");
  assert.equal(route.description, "Ovelo demo API");
  assert.deepEqual(route.accepts, {
    scheme: "exact",
    network: X402.network,
    payTo: X402.payTo,
    maxTimeoutSeconds: X402.maxTimeoutSeconds,
    price: {
      asset: X402.token,
      amount: X402.priceBaseUnits,
      extra: { name: X402.tokenName, version: X402.tokenVersion },
    },
  });
});

test("the 402 body still carries the price, asset, recipient and network", async () => {
  const route = paidRoute("Ovelo demo API");
  const body = await route.unpaidResponseBody?.({} as UnpaidContext);
  assert.equal(body?.contentType, "application/json");
  const parsed = body?.body as Record<string, unknown>;
  assert.equal(parsed.error, "Payment Required");
  assert.equal(parsed.price, X402.priceUsd);
  assert.equal(parsed.asset, "USDC");
  assert.equal(parsed.payTo, X402.payTo);
  assert.equal(parsed.network, X402.network);
});

/** A standard PAYMENT-SIGNATURE header: base64 of the decoded payload. */
function signatureHeader(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

function requestWithHeader(header?: string): Request {
  return new Request("http://localhost/api/weather?city=Oslo", {
    headers: header === undefined ? {} : { "payment-signature": header },
  });
}

test("payerFromRequest reads the payer out of a standard payment header", () => {
  const from = "0x865b100A911a0eEA2ef8781614EB1737526E7683";
  const header = signatureHeader({ x402Version: 2, network: X402.network, payload: { authorization: { from } } });
  assert.equal(payerFromRequest(requestWithHeader(header)), from);
});

test("payerFromRequest returns null when the header is missing or unreadable", () => {
  assert.equal(payerFromRequest(requestWithHeader()), null);
  assert.equal(payerFromRequest(requestWithHeader("not base64!!")), null);
  assert.equal(payerFromRequest(requestWithHeader(signatureHeader({ x402Version: 2, payload: {} }))), null);
  assert.equal(payerFromRequest(requestWithHeader(signatureHeader({ payload: { authorization: { from: "" } } }))), null);
});
