/**
 * OVELO: RESALE TICKET RISK RULES
 *
 * ⚠️  DEMO DATA ONLY. Everything in this file is made up.
 *     These tickets do not exist, and nothing here can check a real
 *     ticket, a real seller, or a real event company.
 *
 * The risk decision is made HERE, in plain TypeScript — never by the AI.
 * The agent's job is only to read `assessTicketRisk` and explain it.
 * That keeps the answer repeatable: the same ticket always gets the
 * same score, and you can read exactly why.
 */

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type Ticket = {
  id: string;
  event: string;
  seat: string;
  /** The person offering the ticket for resale. */
  sellerName: string;
  /** The person the ticket is currently registered to. */
  currentOwnerName: string;
  issuerVerified: boolean;
  alreadyScanned: boolean;
  askingPriceUsd: number;
  faceValueUsd: number;
  /** Highest price this event is allowed to be resold at. */
  resaleCapUsd: number;
  minutesSinceLastTransfer: number;
  /** The organisation that issued the ticket. Used by the paid history report. */
  issuerName: string;
  /**
   * Every registered owner of this ticket, oldest first.
   * The last entry is always `currentOwnerName`.
   * If `sellerName` is NOT in this list, someone outside the ownership
   * chain is trying to sell it — which is exactly what the risk rules catch.
   */
  ownerHistory: string[];
};

export type TicketRisk = {
  ticketId: string;
  riskLevel: RiskLevel;
  score: number;
  /** Plain-English findings. Never empty. */
  reasons: string[];
  recommendation: "ok to proceed" | "ask the buyer to approve first" | "do not fund";
};

export const DEMO_EVENT = "Demo Music Night 2026";

/**
 * Six fake tickets, one per case worth demoing.
 * The numbers are chosen so each ticket triggers a different rule.
 */
export const DEMO_TICKETS: Ticket[] = [
  {
    // Clean: owner is selling, issuer trusted, price under the cap, long-settled.
    id: "OV-1001",
    event: DEMO_EVENT,
    seat: "Floor A · Row 4 · Seat 12",
    sellerName: "Priya Raman",
    currentOwnerName: "Priya Raman",
    issuerVerified: true,
    alreadyScanned: false,
    askingPriceUsd: 165,
    faceValueUsd: 120,
    resaleCapUsd: 180,
    minutesSinceLastTransfer: 4320,
    issuerName: "Demo Music Night Official Box Office",
    ownerHistory: ["Nisha Raman", "Priya Raman"],
  },
  {
    // The barcode has already been read at the gate → it is being resold twice.
    id: "OV-1002",
    event: DEMO_EVENT,
    seat: "Balcony B · Row 11 · Seat 6",
    sellerName: "Daniel Okafor",
    currentOwnerName: "Daniel Okafor",
    issuerVerified: true,
    alreadyScanned: true,
    askingPriceUsd: 175,
    faceValueUsd: 120,
    resaleCapUsd: 180,
    minutesSinceLastTransfer: 2880,
    issuerName: "Demo Music Night Official Box Office",
    ownerHistory: ["Omar Okafor", "Daniel Okafor"],
  },
  {
    // Seller does not match the registered owner → third-party resale.
    id: "OV-1003",
    event: DEMO_EVENT,
    seat: "Floor A · Row 7 · Seat 3",
    sellerName: "Marcus Feld",
    currentOwnerName: "Aisha Bello",
    issuerVerified: true,
    alreadyScanned: false,
    askingPriceUsd: 190,
    faceValueUsd: 120,
    resaleCapUsd: 180,
    minutesSinceLastTransfer: 1440,
    issuerName: "Moonlight Ticketing Co.",
    // Marcus Feld sells this one but has never owned it — he is absent here on purpose.
    ownerHistory: ["Leo Bello", "Aisha Bello"],
  },
  {
    // Asking price is more than double the cap → clear profit motive.
    id: "OV-1004",
    event: DEMO_EVENT,
    seat: "Floor C · Row 2 · Seat 21",
    sellerName: "Sofia Marino",
    currentOwnerName: "Sofia Marino",
    issuerVerified: true,
    alreadyScanned: false,
    askingPriceUsd: 480,
    faceValueUsd: 120,
    resaleCapUsd: 200,
    minutesSinceLastTransfer: 5760,
    issuerName: "Demo Music Night Official Box Office",
    ownerHistory: ["Clara Villanueva", "Diego Herrera", "Sofia Marino"],
  },
  {
    // The issuer is not on the trusted list → counterfeit risk.
    id: "OV-1005",
    event: DEMO_EVENT,
    seat: "Floor B · Row 9 · Seat 15",
    sellerName: "Tomás Rivera",
    currentOwnerName: "Tomás Rivera",
    issuerVerified: false,
    alreadyScanned: false,
    askingPriceUsd: 170,
    faceValueUsd: 120,
    resaleCapUsd: 180,
    minutesSinceLastTransfer: 3020,
    issuerName: "GlobalTix Resale Hub",
    ownerHistory: ["Yusuf Rahman", "Tomás Rivera"],
  },
  {
    // Just transferred, and a little over the cap → worth pausing on.
    id: "OV-1006",
    event: DEMO_EVENT,
    seat: "Balcony A · Row 3 · Seat 8",
    sellerName: "Hana Ito",
    currentOwnerName: "Hana Ito",
    issuerVerified: true,
    alreadyScanned: false,
    askingPriceUsd: 230,
    faceValueUsd: 120,
    resaleCapUsd: 200,
    minutesSinceLastTransfer: 2,
    issuerName: "Moonlight Ticketing Co.",
    ownerHistory: ["Mira Kapoor", "Ravi Sharma", "Hana Ito"],
  },
];

export const DEMO_TICKET_IDS: string[] = DEMO_TICKETS.map((t) => t.id);

/** Lookup is forgiving about case and stray spaces, since a model may send "ov-1002". */
export function findDemoTicket(ticketId: string): Ticket | undefined {
  const wanted = ticketId.trim().toUpperCase();
  return DEMO_TICKETS.find((t) => t.id.toUpperCase() === wanted);
}

function usd(amount: number): string {
  return `$${amount}`;
}

/** Score → level. HIGH at 70 or more, MEDIUM from 25, LOW below that. */
function levelFor(score: number): RiskLevel {
  if (score >= 70) return "HIGH";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

function recommendationFor(level: RiskLevel): TicketRisk["recommendation"] {
  if (level === "HIGH") return "do not fund";
  if (level === "MEDIUM") return "ask the buyer to approve first";
  return "ok to proceed";
}

/**
 * The whole decision, in one readable function.
 * Each rule adds points and a sentence explaining itself.
 * Change a number here and every answer for that rule changes with it.
 */
export function assessTicketRisk(ticket: Ticket): TicketRisk {
  let score = 0;
  const reasons: string[] = [];

  if (ticket.alreadyScanned) {
    score += 100;
    reasons.push("This ticket has already been scanned at the gate, so it is being resold a second time and may be a duplicate.");
  }

  if (ticket.sellerName.trim().toLowerCase() !== ticket.currentOwnerName.trim().toLowerCase()) {
    score += 100;
    reasons.push(`The seller (${ticket.sellerName}) is not the current owner of the ticket (${ticket.currentOwnerName}), so it is a third-party resale.`);
  }

  if (!ticket.issuerVerified) {
    score += 80;
    reasons.push("The event's ticket issuer is not verified, so this ticket may be fake or from an unofficial source.");
  }

  if (ticket.askingPriceUsd > ticket.resaleCapUsd) {
    if (ticket.askingPriceUsd > 2 * ticket.resaleCapUsd) {
      score += 70;
      reasons.push(`The asking price of ${usd(ticket.askingPriceUsd)} is more than twice the resale cap of ${usd(ticket.resaleCapUsd)}, which suggests a resale scam.`);
    } else {
      score += 40;
      reasons.push(`The asking price of ${usd(ticket.askingPriceUsd)} is above the resale cap of ${usd(ticket.resaleCapUsd)}.`);
    }
  }

  if (ticket.minutesSinceLastTransfer < 10) {
    score += 25;
    reasons.push(`This ticket changed hands only ${ticket.minutesSinceLastTransfer} minute(s) ago, so the price and ownership may not have settled yet.`);
  }

  // Never hand back an empty list — the agent needs something to explain.
  if (reasons.length === 0) {
    reasons.push("Nothing suspicious found: the seller is the current owner, the issuer is verified, the price is within the resale cap, and the ticket has been settled for a while.");
  }

  const riskLevel = levelFor(score);

  return {
    ticketId: ticket.id,
    riskLevel,
    score,
    reasons,
    recommendation: recommendationFor(riskLevel),
  };
}