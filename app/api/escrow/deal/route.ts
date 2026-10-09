/**
 * GET /api/escrow/deal?dealId=123
 * GET /api/escrow/deal?runId=ab12cd34&ticketId=OV-1001
 *
 * Read-only status of one escrow deal (no transaction, no key). Reads can lag
 * on a load-balanced RPC, so the client is expected to re-call this if a value
 * looks stale right after a write.
 */
import { getDealIdForKey, readDeal, ticketKeyFor } from "@/agent/escrow";
import type { Hex } from "viem";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url, "http://placeholder.invalid");
  const rawDealId = url.searchParams.get("dealId");
  const runId = url.searchParams.get("runId");
  const ticketId = url.searchParams.get("ticketId");

  let dealId: bigint | null = null;

  if (rawDealId) {
    try {
      dealId = BigInt(rawDealId);
    } catch {
      return Response.json({ error: "dealId must be a number." }, { status: 400 });
    }
  } else if (runId && ticketId) {
    const key = ticketKeyFor(ticketId, runId) as Hex;
    const found = await getDealIdForKey(key);
    if (found === 0n) {
      return Response.json({ error: "No deal found for that runId and ticketId." }, { status: 404 });
    }
    dealId = found;
  } else {
    return Response.json({ error: "Provide dealId, or both runId and ticketId." }, { status: 400 });
  }

  const deal = await readDeal(dealId);
  if (!deal) {
    // Try to be resilient to stale RPC reads; also allow recovery by scanning
    // state not stored here. But we must return a clear error shape.
    return Response.json({ error: `There is no deal with id ${dealId}.` }, { status: 404 });
  }
  return Response.json({ deal });
}
