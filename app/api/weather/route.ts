/**
 * A MOCK PAID WEATHER API
 *
 * Pretend this is someone else's API that charges per request.
 * No payment -> 402 Payment Required. A verified, settled payment -> the weather.
 *
 * The paywall itself (402, verification, on-chain settlement) lives in
 * agent/x402-server.ts; this route only builds the answer.
 */
import { NextResponse, type NextRequest } from "next/server";
import { paidRoute, payerFromRequest, protectPaidRoute } from "@/agent/x402-server";

// The answer depends on the payment header, so this route is never static.
export const dynamic = "force-dynamic";
// Settlement talks to the facilitator; give it the same budget as the escrow routes.
export const maxDuration = 60;

const handler = async (req: NextRequest) => {
  // `req.url` is sometimes only a path behind a proxy. The dummy base is
  // ignored when the URL is already absolute; it just stops the parse throwing.
  const city = new URL(req.url, "http://placeholder.invalid").searchParams.get("city") ?? "Unknown";

  // Fake weather — swap in a real API here if you like.
  const conditions = ["Sunny", "Cloudy", "Rainy", "Windy", "Stormy"];
  return NextResponse.json({
    city,
    temperatureC: Math.round(15 + Math.random() * 20),
    condition: conditions[Math.floor(Math.random() * conditions.length)],
    // The paywall verified this payment before the handler ran, so the payer
    // address is always there; "unknown" only if the header somehow is not.
    paidBy: payerFromRequest(req) ?? "unknown",
  });
};

export const GET = protectPaidRoute(handler, paidRoute("Ovelo demo weather API. 0.01 test USDC per request."));
