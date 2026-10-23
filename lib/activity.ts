/**
 * ACTIVITY LOG (client-side, in memory only)
 *
 * Plain descriptions of every decision and payment this browser session saw.
 * Nothing here is invented: each event is built from data the app already has
 * (the chat tool results, the escrow API responses, or the wallet data). If a
 * field is missing, the event simply leaves it out.
 *
 * The log lives in React state in app/page.tsx and resets on page refresh.
 */

export type ActivityOutcome = "done" | "refused" | "waiting";

/** Which known address the money moved to. Resolved to a real address in the UI. */
export type ActivityCounterparty = "escrow" | "agent" | "apiOwner";

export type ActivityEvent = {
  id: string;
  /** ISO timestamp, set when the event was created. */
  at: string;
  /** What happened, in plain words. */
  title: string;
  outcome: ActivityOutcome;
  ticketId?: string;
  /** Why it happened / why it was refused. */
  reason?: string;
  /** Amount in test USDC, e.g. "1" or "0.01". */
  amount?: string;
  /** Optional note about the amount (e.g. settled x402 payment). */
  amountNote?: string;
  counterparty?: ActivityCounterparty;
  /** Recipient address when it is neither the escrow nor the agent wallet. */
  counterpartyAddress?: string;
  hash?: string;
  /** Basescan link, when a real transaction exists. */
  url?: string;
  /**
   * TRUE only when Ovelo read the transaction receipt back from the chain and
   * found the expected USDC Transfer. Undefined/false means the facilitator
   * reported the payment but our own check did not confirm it.
   */
  verified?: boolean;
  /** Block the settlement landed in, only when `verified` is true. */
  blockNumber?: string;
  /** True when this event describes a cached report, not a new payment. */
  reused?: boolean;
};

/** Minimal shape of a chat tool step (matches Step in components/check-tab.tsx). */
type RawStep = { tool?: string; args?: any; result?: any; error?: boolean };

let counter = 0;

function nextId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

/** Build an event, stamping it with an id and the current time. */
export function makeActivityEvent(
  event: Omit<ActivityEvent, "id" | "at"> & { at?: string }
): ActivityEvent {
  const { at, ...rest } = event;
  return { id: nextId(), at: at ?? new Date().toISOString(), ...rest };
}

/** "0.01 USDC" -> "0.01". Leaves anything unexpected untouched. */
function paymentAmountUsdc(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const match = raw.match(/^\s*([0-9.]+)\s*USDC\s*$/i);
  return match ? match[1] : raw;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * Turn the tool steps of one agent reply into activity events.
 * Only the tools with something worth logging produce an event.
 */
export function activityFromSteps(steps: RawStep[] | undefined): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  if (!Array.isArray(steps)) return out;

  for (const step of steps) {
    const r = (step?.result ?? {}) as Record<string, any>;

    if (step.tool === "get_ticket_history_report") {
      const ticketId = str(r?.data?.ticket?.id) ?? str(step?.args?.ticketId);

      if (r?.reused === true) {
        const hash = str(r?.reusedFromTxHash) ?? str(r?.payment?.txHash);
        const blockNumber = str(r?.blockNumber) ?? str(r?.payment?.blockNumber);
        // This is the ORIGINAL payment, not a new one. Keep the amount out of
        // the event entirely so nothing can present it as a fresh charge.
        const verified = Boolean(hash) && r?.payment?.verified === true;

        out.push(
          makeActivityEvent({
            title: ticketId
              ? `Reused report (no new payment) for ${ticketId}`
              : "Reused report (no new payment)",
            outcome: "done",
            ticketId,
            amountNote: verified
              ? `original payment settled on-chain${blockNumber ? ` · block ${blockNumber}` : ""}`
              : "original payment — not verified on-chain",
            hash,
            url: str(r?.payment?.url),
            verified: hash ? verified : undefined,
            blockNumber: verified ? blockNumber : undefined,
            reused: true,
          })
        );
        continue;
      }

      const amount = paymentAmountUsdc(r?.payment?.amount);
      if (amount) {
        const hash = str(r?.payment?.txHash);
        const blockNumber = str(r?.payment?.blockNumber);
        // "settled on-chain" is only claimed when Ovelo itself read the receipt
        // back from the chain and found the expected USDC Transfer. Otherwise the
        // payment is still logged (the money may have moved) but honestly labelled.
        const verified = Boolean(hash) && r?.payment?.verified === true;

        out.push(
          makeActivityEvent({
            title: ticketId ? `Bought the paid history report for ${ticketId}` : "Bought the paid history report",
            outcome: "done",
            ticketId,
            amount,
            amountNote: verified
              ? `settled on-chain via x402${blockNumber ? ` · block ${blockNumber}` : ""}`
              : hash
                ? "paid — facilitator reported success but not verified on-chain"
                : undefined,
            counterparty: "apiOwner",
            counterpartyAddress: str(r?.payment?.to),
            hash,
            url: str(r?.payment?.url),
            verified: hash ? verified : undefined,
            blockNumber: verified ? blockNumber : undefined,
          })
        );
      }
      continue;
    }

    if (step.tool === "check_ticket_risk") {
      if (step.error || r?.found === false) continue;
      const level = r?.riskLevel;
      if (level !== "LOW" && level !== "MEDIUM" && level !== "HIGH") continue;
      const ticketId = str(r?.ticketId);
      const score = typeof r?.score === "number" ? r.score : undefined;
      const topReason = Array.isArray(r?.reasons) ? str(r.reasons[0]) : undefined;

      out.push(
        makeActivityEvent({
          title: `${ticketId ? `Checked ${ticketId}` : "Checked ticket"} — ${level} risk${
            score !== undefined ? ` (score ${score})` : ""
          }`,
          outcome: "done",
          ticketId,
          reason: topReason,
        })
      );

      // The funding decision the agent makes next, straight from the rules.
      if (level === "HIGH") {
        out.push(
          makeActivityEvent({
            title: `Funding refused for ${ticketId ?? "the ticket"} — HIGH risk`,
            outcome: "refused",
            ticketId,
            reason: topReason ?? "HIGH-risk tickets are never funded.",
          })
        );
      } else if (level === "MEDIUM") {
        out.push(
          makeActivityEvent({
            title: `Waiting for your approval to fund ${ticketId ?? "the ticket"}`,
            outcome: "waiting",
            ticketId,
            reason: "MEDIUM risk — Ovelo needs your approval before it funds this ticket.",
          })
        );
      }
      continue;
    }

    if (step.tool === "fund_escrow") {
      const ticketId = str(r?.ticketId) ?? str(step?.args?.ticketId);
      const links = Array.isArray(r?.links) ? r.links : [];
      const fundLink = r?.fundTx ?? links.find((l: any) => l?.kind === "fund") ?? null;

      if (r?.ok === true) {
        out.push(
          makeActivityEvent({
            title: `Funded escrow for ${ticketId ?? "the ticket"}`,
            outcome: "done",
            ticketId,
            amount: "1",
            counterparty: "escrow",
            hash: str(fundLink?.hash),
            url: str(fundLink?.url),
          })
        );
      } else if (r?.riskLevel === "MEDIUM") {
        out.push(
          makeActivityEvent({
            title: `Waiting for your approval to fund ${ticketId ?? "the ticket"}`,
            outcome: "waiting",
            ticketId,
            reason: str(r?.message) ?? "MEDIUM risk — approval needed.",
          })
        );
      } else {
        out.push(
          makeActivityEvent({
            title: `Funding refused for ${ticketId ?? "the ticket"}`,
            outcome: "refused",
            ticketId,
            reason: str(r?.message) ?? "The funding was refused.",
          })
        );
      }
      continue;
    }

    if (step.tool === "compare_tickets") {
      if (r?.ok === true && typeof r?.compared === "number") {
        const safest = str(r?.safestTicketId);
        out.push(
          makeActivityEvent({
            title: `Compared ${r.compared} ticket${r.compared === 1 ? "" : "s"}`,
            outcome: "done",
            reason: safest ? `Safest: ${safest}` : undefined,
          })
        );
      }
      continue;
    }

    if (step.tool === "get_deal_status") {
      if (r?.ok !== true) continue;
      if (r?.found === false) {
        out.push(
          makeActivityEvent({
            title: `Looked up deal ${str(r?.dealId) ?? ""}`.trim(),
            outcome: "done",
            reason: str(r?.message) ?? "Not found yet.",
          })
        );
      } else if (r?.found === true) {
        out.push(
          makeActivityEvent({
            title: `Looked up deal ${str(r?.dealId) ?? ""} — ${str(r?.status) ?? "status"}`
              .replace(/\s+—\s+status$/, "")
              .trim(),
            outcome: "done",
            reason: str(r?.amountUsdc) ? `${r.amountUsdc} test USDC` : undefined,
          })
        );
      } else if (typeof r?.openDeals === "number") {
        out.push(
          makeActivityEvent({
            title: r.openDeals === 0 ? "Checked open deals — none open" : `Checked open deals — ${r.openDeals} open`,
            outcome: "done",
          })
        );
      }
      continue;
    }
  }

  return out;
}
