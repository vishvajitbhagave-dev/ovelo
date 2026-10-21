/**
 * A PAID TICKET HISTORY REPORT API (demo)
 *
 * Same paywall as the weather API:
 *
 *   1. Unknown ticket id     -> 404 with the list of valid ids (never a crash,
 *                               checked BEFORE the paywall so a typo costs nothing)
 *   2. No payment            -> 402 Payment Required (price, asset, payTo)
 *   3. Verified payment      -> 200 with the history report, once the payment
 *                               has settled on-chain (see agent/x402-server.ts)
 *
 * ⚠️  FAKE DATA ONLY. This invents a history for six demo tickets.
 *     It cannot look up any real ticket, seller, issuer or event company.
 *
 * Deliberately contains NO risk level, score or recommendation: the risk
 * answer must only ever come from the `check_ticket_risk` tool, so the two
 * stay independent of each other.
 */
import { NextResponse, type NextRequest } from "next/server";
import { paidRoute, payerFromRequest, protectPaidRoute } from "@/agent/x402-server";
import { DEMO_TICKET_IDS, findDemoTicket, type Ticket } from "@/agent/tickets";

// The answer depends on the payment header, so this route is never static.
export const dynamic = "force-dynamic";
// Settlement talks to the facilitator; give it the same budget as the escrow routes.
export const maxDuration = 60;

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

/** Unknown id -> 404 with the list of valid ids (never a crash). */
function ticketNotFound(rawTicketId: string | null) {
  return NextResponse.json(
    {
      error: `No ticket history found for "${rawTicketId ?? ""}"`,
      message: "That ticket id does not exist. This API only has demo tickets.",
      validTicketIds: DEMO_TICKET_IDS,
    },
    { status: 404 }
  );
}

/** Runs behind the paywall: the payment is verified before this is ever called. */
const handler = async (req: NextRequest) => {
  const url = new URL(req.url, "http://placeholder.invalid");
  const rawTicketId = url.searchParams.get("ticketId");
  const ticket = rawTicketId ? findDemoTicket(rawTicketId) : undefined;

  // Checked again here, so the paid handler can never return a report for an
  // unknown id even if it were ever reached without the gate above.
  if (!ticket) return ticketNotFound(rawTicketId);

  // Paid -> the report, addressed to whoever's payment was verified.
  return NextResponse.json(buildReport(ticket, payerFromRequest(req) ?? "unknown"));
};

const paidGet = protectPaidRoute(handler, paidRoute("Ovelo demo ticket history report. 0.01 test USDC per request."));

export async function GET(req: NextRequest) {
  // 1. Unknown id -> 404, checked before the paywall so a typo never costs money.
  const rawTicketId = new URL(req.url, "http://placeholder.invalid").searchParams.get("ticketId");
  if (!rawTicketId || !findDemoTicket(rawTicketId)) return ticketNotFound(rawTicketId);

  // 2. Known id -> 402 until it is paid, then the report.
  return paidGet(req);
}
