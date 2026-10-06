/**
 * A PAID TICKET HISTORY REPORT API (demo)
 *
 * Same x402 pattern as the weather API:
 *
 *   1. No payment            -> 402 Payment Required + { price, asset, payTo }
 *   2. Signed payment        -> 200 with the history report
 *   3. Unknown ticket id     -> 404 with the list of valid ids (never a crash)
 *
 * ⚠️  FAKE DATA ONLY. This invents a history for six demo tickets.
 *     It cannot look up any real ticket, seller, issuer or event company.
 *
 * Deliberately contains NO risk level, score or recommendation: the risk
 * answer must only ever come from the `check_ticket_risk` tool, so the two
 * stay independent of each other.
 */
import { verifyPayment } from "@/agent/wallet";
import { DEMO_TICKET_IDS, findDemoTicket, type Ticket } from "@/agent/tickets";

// Same price as the weather API (app/api/weather/route.ts) — keep in sync.
const PRICE = "0.01";
const ASSET = "USDC";
const PAY_TO = "0x000000000000000000000000000000000000dEaD"; // the API owner's wallet (demo)

/** Pretend the ticket was issued this long before its most recent transfer. */
const ISSUE_OFFSET_MINUTES = 10080; // 7 days

type ReportEvent = {
  type: "issued" | "transferred" | "scanned" | "not_scanned";
  detail: string;
  minutesAgo?: number;
  when?: string;
  /** Who the ticket went to on an "issued" event. */
  to?: string;
  /** Who it came from / went to on a "transferred" event. */
  from?: string;
};

/** "12 minutes ago" / "3 hours ago" / "4 days ago". Always deterministic. */
function ago(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.floor(minutes / 1440);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * Build the timeline out of the ticket's own fields, so it can never
 * contradict the flags the risk rules look at:
 *
 *   - issued        -> first entry of ownerHistory, issued by the issuer
 *   - transferred   -> ownerHistory[n-2] -> ownerHistory[n-1], using
 *                      minutesSinceLastTransfer (the same value the rules score)
 *   - scanned       -> present only when alreadyScanned is true
 */
function buildTimeline(ticket: Ticket): ReportEvent[] {
  const firstOwner = ticket.ownerHistory[0];
  const issuedMinutesAgo = ticket.minutesSinceLastTransfer + ISSUE_OFFSET_MINUTES;

  const events: ReportEvent[] = [
    {
      type: "issued",
      minutesAgo: issuedMinutesAgo,
      when: ago(issuedMinutesAgo),
      to: firstOwner,
      detail: `Ticket issued to ${firstOwner} by ${ticket.issuerName}.`,
    },
  ];

  const previousOwner = ticket.ownerHistory[ticket.ownerHistory.length - 2];
  if (previousOwner) {
    events.push({
      type: "transferred",
      minutesAgo: ticket.minutesSinceLastTransfer,
      when: ago(ticket.minutesSinceLastTransfer),
      from: previousOwner,
      to: ticket.currentOwnerName,
      detail: `Transferred from ${previousOwner} to ${ticket.currentOwnerName}.`,
    });
  }

  events.push(
    ticket.alreadyScanned
      ? { type: "scanned", detail: "This ticket HAS already been scanned at the gate." }
      : { type: "not_scanned", detail: "This ticket has NOT been scanned at the gate." }
  );

  return events;
}

function buildReport(ticket: Ticket, paidBy: string) {
  const isSellerTheOwner = ticket.sellerName.trim().toLowerCase() === ticket.currentOwnerName.trim().toLowerCase();

  return {
    reportType: "ticket-history-report",
    demoOnly: true,
    note:
      "This report is background evidence only. It deliberately contains no risk level. " +
      "Use the check_ticket_risk tool for the risk level, score, reasons and recommendation.",
    paidBy,
    ticket: {
      id: ticket.id,
      event: ticket.event,
      seat: ticket.seat,
      sellerName: ticket.sellerName,
      currentOwnerName: ticket.currentOwnerName,
      sellerIsCurrentOwner: isSellerTheOwner,
      askingPriceUsd: ticket.askingPriceUsd,
      resaleCapUsd: ticket.resaleCapUsd,
    },
    issuer: {
      name: ticket.issuerName,
      verified: ticket.issuerVerified,
    },
    originalFaceValueUsd: ticket.faceValueUsd,
    ownerCount: ticket.ownerHistory.length,
    owners: ticket.ownerHistory,
    timeline: buildTimeline(ticket),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url, "http://placeholder.invalid");
  const rawTicketId = url.searchParams.get("ticketId");
  const ticket = rawTicketId ? findDemoTicket(rawTicketId) : undefined;

  // 1. Unknown id -> 404 (checked before the paywall so it never crashes).
  if (!ticket) {
    return Response.json(
      {
        error: `No ticket history found for "${rawTicketId ?? ""}"`,
        message: "That ticket id does not exist. This API only has demo tickets.",
        validTicketIds: DEMO_TICKET_IDS,
      },
      { status: 404 }
    );
  }

  // 2. No (or bad) payment -> 402, telling the caller exactly what to pay.
  const payment = await verifyPayment(req.headers.get("X-PAYMENT"));
  if (!payment || payment.to !== PAY_TO || Number(payment.amount) < Number(PRICE)) {
    return Response.json({ error: "Payment Required", price: PRICE, asset: ASSET, payTo: PAY_TO }, { status: 402 });
  }

  // 3. Paid -> the report.
  return Response.json(buildReport(ticket, payment.from));
}
