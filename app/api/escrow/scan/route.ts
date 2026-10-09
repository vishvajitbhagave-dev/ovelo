/**
 * POST /api/escrow/scan
 *
 * Body: { dealId } OR { runId, ticketId }
 *
 * The demo scanner checks in, which releases the escrowed 1 USDC to the seller.
 * It SIMULATES first, so a second scan of the same deal is rejected with the
 * contract's own plain-English reason and NO transaction is sent.
 *
 * Returns only public data (tx hash, Basescan link, status, rejection reason).
 */
import { getDealIdForKey, scanAtGate, ticketKeyFor } from "@/agent/escrow";
import type { Hex } from "viem";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { dealId?: unknown; runId?: unknown; ticketId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let dealId: bigint | null = null;

  if (body?.dealId !== undefined && body?.dealId !== null && String(body.dealId).trim() !== "") {
    try {
      dealId = BigInt(String(body.dealId));
    } catch {
      return Response.json({ error: "dealId must be a number." }, { status: 400 });
    }
  } else if (body?.runId && body?.ticketId) {
    const key = ticketKeyFor(String(body.ticketId), String(body.runId)) as Hex;
    const found = await getDealIdForKey(key);
    if (found === 0n) {
      return Response.json(
        { error: "No deal was found for that ticketId and runId. Fund the escrow first." },
        { status: 404 }
      );
    }
    dealId = found;
  } else {
    return Response.json({ error: "Provide either dealId, or both runId and ticketId." }, { status: 400 });
  }

  const result = await scanAtGate({ dealId });

  if (!result.ok) {
    return Response.json(
      { ok: false, rejected: result.rejected, message: result.message, status: result.dealStatus ?? null },
      { status: 200 }
    );
  }

  return Response.json(result, { status: 200 });
}
