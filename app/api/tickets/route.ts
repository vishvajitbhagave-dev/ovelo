/**
 * GET /api/tickets -> the six demo tickets for the Tickets tab.
 *
 * Read-only, no payment, no risk level: the risk answer must only ever come
 * from the `check_ticket_risk` tool, so this route deliberately does not
 * expose it.
 *
 * Only the fields the Tickets tab shows are returned — an explicit allowlist,
 * so nothing else from agent/tickets.ts can leak out by accident.
 *
 * ⚠️  DEMO DATA ONLY (see agent/tickets.ts).
 */
import { DEMO_EVENT, DEMO_TICKETS } from "@/agent/tickets";

export async function GET() {
  return Response.json({
    demoOnly: true,
    event: DEMO_EVENT,
    count: DEMO_TICKETS.length,
    tickets: DEMO_TICKETS.map((t) => ({
      id: t.id,
      event: t.event,
      seat: t.seat,
      sellerName: t.sellerName,
      askingPriceUsd: t.askingPriceUsd,
    })),
  });
}
