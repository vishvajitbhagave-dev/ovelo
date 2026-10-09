/**
 * GET /api/escrow/open-deals
 *
 * Read-only. Lists every deal this agent (as buyer) still has open, i.e. Funded
 * and not yet released or refunded, and flags which ones have passed their
 * deadline (so they can be refunded). Returns public data only.
 */
import { listOpenDeals } from "@/agent/escrow";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { deals, chainTime } = await listOpenDeals();
    return Response.json({ ok: true, deals, chainTime }, { status: 200 });
  } catch {
    return Response.json({ ok: false, deals: [], chainTime: Math.floor(Date.now() / 1000) }, { status: 200 });
  }
}
