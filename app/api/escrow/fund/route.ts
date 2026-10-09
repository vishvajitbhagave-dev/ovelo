/**
 * POST /api/escrow/fund
 *
 * Body: { ticketId: string, approved?: boolean }
 *
 * The server recomputes the risk itself (never trusts the client or the AI):
 *   - HIGH            -> refused, with the reasons from the rules.
 *   - MEDIUM          -> refused unless { approved: true } (the UI Approve button).
 *   - LOW             -> allowed.
 * Then it runs the safety guards and, if everything passes, approves and funds
 * exactly 1 test USDC on Base Sepolia.
 *
 * Returns ONLY public data (tx hashes, Basescan links, deal id, status). It never
 * returns or echoes a private key.
 */
import { fundEscrow, isKnownTicket } from "@/agent/escrow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { ticketId?: unknown; approved?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const ticketId = String(body?.ticketId ?? "").trim();
  const approved = body?.approved === true;

  if (!ticketId) {
    return Response.json({ error: "Missing ticketId." }, { status: 400 });
  }
  if (!isKnownTicket(ticketId)) {
    return Response.json(
      { error: `There is no demo ticket with id "${ticketId}", so nothing can be funded.` },
      { status: 404 }
    );
  }

  const result = await fundEscrow({ ticketId, approved });

  if (!result.ok) {
    // Expected business refusals (risk/guard/already-open) are a normal 200 with refused: true.
    return Response.json(
      {
        ok: false,
        refused: true,
        code: result.code,
        message: result.message,
        risk: result.risk ?? null,
        existing: result.existing ?? null,
      },
      { status: 200 }
    );
  }

  // If funding tx succeeded but dealId couldn't be read (stale RPC), still return success
  // with links; the client can recover dealId later via /api/escrow/deal?runId&ticketId.
  return Response.json(result, { status: 200 });
}
