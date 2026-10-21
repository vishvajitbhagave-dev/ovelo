/**
 * THE PAID APIs' SIDE OF x402 (the resource server)
 *
 * `agent/x402.ts` is the payer. This file is the payee: it wires the official
 * SDK's resource server (@x402/core/server + @x402/evm) to the public testnet
 * facilitator, and it is what a route uses to demand payment:
 *
 *   1. No PAYMENT-SIGNATURE header -> 402, with a standard PAYMENT-REQUIRED
 *      header saying what to pay (0.01 test USDC to X402.payTo).
 *   2. PAYMENT-SIGNATURE present -> the facilitator verifies the signed
 *      EIP-3009 authorization BEFORE the route handler runs.
 *   3. Handler answers 2xx -> the facilitator settles the payment on Base
 *      Sepolia and the response carries a PAYMENT-RESPONSE header with the
 *      transaction hash. A handler error (>= 400) cancels the settlement, so a
 *      request that did not succeed never takes money.
 *
 * Nothing here holds a key or sends a transaction: the payer signs, the
 * facilitator settles, and this file only decides whether a request is paid.
 */
import { decodePaymentSignatureHeader } from "@x402/core/http";
import { HTTPFacilitatorClient, x402ResourceServer, type RouteConfig } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import type { NextRequest, NextResponse } from "next/server";
import { X402 } from "./x402-config";

/** The one shared resource server: the testnet facilitator + the exact scheme. */
let shared: x402ResourceServer | null = null;

function resource(): x402ResourceServer {
  if (!shared) {
    shared = new x402ResourceServer(new HTTPFacilitatorClient({ url: X402.facilitatorUrl }));
    shared.register(X402.network, new ExactEvmScheme());
  }
  return shared;
}

/**
 * The route config both paid demo APIs share: one price, one recipient, one
 * network. The price is an exact token amount (0.01 USDC in base units), not a
 * dollar string, so no exchange rate or price feed is ever consulted.
 *
 * The 402 body also states the price in plain JSON (price, asset, payTo,
 * network), so a human reading it with curl sees what to pay without having to
 * decode a header. The standard protocol lives in the headers themselves.
 */
export function paidRoute(description: string): RouteConfig {
  return {
    description,
    accepts: {
      scheme: "exact",
      network: X402.network,
      payTo: X402.payTo,
      // The signed authorization is only valid this long, and the route handler
      // must finish settling inside it. Kept explicit (the SDK default is 300s).
      maxTimeoutSeconds: X402.maxTimeoutSeconds,
      price: {
        asset: X402.token,
        amount: X402.priceBaseUnits,
        // The token's EIP-712 domain travels with the price: the payer cannot
        // sign an EIP-3009 authorization without name and version. Both come
        // from the config, not from an exchange rate or a price feed.
        extra: { name: X402.tokenName, version: X402.tokenVersion },
      },
    },
    unpaidResponseBody: () => ({
      contentType: "application/json",
      body: {
        error: "Payment Required",
        price: X402.priceUsd,
        asset: "USDC",
        payTo: X402.payTo,
        network: X402.network,
      },
    }),
  };
}

/**
 * The payer's address, read back out of the PAYMENT-SIGNATURE header.
 *
 * This is only ever called from inside a handler that `protectPaidRoute` has
 * already guarded, so by then the facilitator has verified this exact header —
 * `payload.authorization.from` is the address that was checked and will be
 * settled from. Returns null when the header is missing or unreadable; the
 * handler decides what to do with that.
 */
export function payerFromRequest(req: Request): string | null {
  const header = req.headers.get("payment-signature");
  if (!header) return null;
  try {
    const authorization = decodePaymentSignatureHeader(header).payload as {
      authorization?: { from?: unknown };
    };
    const from = authorization?.authorization?.from;
    return typeof from === "string" && from !== "" ? from : null;
  } catch {
    return null;
  }
}

type PaidHandler = (req: NextRequest) => Promise<NextResponse>;

/**
 * Put the paywall in front of a route handler.
 *
 * The `@x402/next` package is imported lazily on the first request: it pulls in
 * `next/server`, which only resolves inside a Next.js bundle, so loading it at
 * module scope would break the plain-Node unit tests that import this file for
 * its config helpers. The facilitator is only contacted from there on too, so
 * importing this module costs no network call.
 */
export function protectPaidRoute(handler: PaidHandler, route: RouteConfig): PaidHandler {
  let wrapped: PaidHandler | null = null;
  return async (req) => {
    if (!wrapped) {
      const { withX402 } = await import("@x402/next");
      wrapped = withX402(handler, route, resource());
    }
    return wrapped(req);
  };
}
