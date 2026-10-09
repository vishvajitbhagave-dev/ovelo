"use client";
/**
 * CHECK TAB — the REAL flow.
 *
 * Pressing "Check this ticket" sends "Check ticket OV-100X" to the existing
 * agent (/api/agent). The agent buys the paid history report, then runs
 * check_ticket_risk. Everything shown here is read back out of those tool
 * results:
 *
 *   - RiskCard            <- check_ticket_risk result (rules live in code)
 *   - receipt chip        <- the payment object the wallet actually signed
 *   - history timeline    <- the paid report's timeline
 *   - issuer / owners     <- the paid report
 *   - "Ovelo says"        <- the agent's written answer
 *
 * Nothing here is invented: if a piece is missing (no payment, report not
 * bought, risk not found), that piece is simply not shown.
 */
import { useEffect, useState } from "react";
import {
  BadgeAlert,
  BadgeCheck,
  ExternalLink,
  LoaderCircle,
  Lock,
  Receipt,
  ScanLine,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Users,
} from "lucide-react";
import { RiskCard, parseRiskResult, type RiskLevel } from "@/components/risk-card";
import { cn } from "@/lib/utils";

export type Step = { tool: string; args: unknown; result: any; error?: boolean };

/** One real escrow transaction, kept for the session list in the Agent wallet tab. */
export type EscrowTx = {
  kind: "approve" | "fund" | "scan" | "refund";
  hash: string;
  url: string;
  ticketId: string;
  dealId?: string;
  at: string;
};

/**
 * A deal the agent funded from the CHAT (not the Check tab button). The page
 * parses it from the successful fund_escrow tool result and hands it down so the
 * Check tab can show it and let the user scan it at the gate.
 */
export type FundedDeal = {
  dealId: string;
  runId: string;
  status: string;
  links: { kind: EscrowTx["kind"]; hash: string; url: string }[];
};

export type CheckState =
  | { status: "idle" }
  | { status: "loading"; id: string }
  | { status: "error"; id: string; message: string }
  | { status: "done"; id: string; answer: string; steps: Step[] };

const TIMELINE_LABEL: Record<string, string> = {
  issued: "Issued",
  transferred: "Transferred",
  scanned: "Scanned",
  not_scanned: "Not scanned",
};

export function CheckTab({
  check,
  onRun,
  onEscrowTx,
  fundedDeal,
}: {
  check: CheckState;
  onRun: (id: string) => void;
  onEscrowTx: (txs: EscrowTx[]) => void;
  fundedDeal?: FundedDeal | null;
}) {
  return (
    <section className="space-y-5">
      {check.status === "idle" && <IdleState />}
      {check.status === "loading" && <LoadingState id={check.id} />}
      {check.status === "error" && <ErrorState check={check} onRun={onRun} />}
      {check.status === "done" && (
        <DoneCheck check={check} onEscrowTx={onEscrowTx} fundedDeal={fundedDeal} />
      )}
    </section>
  );
}

function IdleState() {
  return (
    <div className="card-surface flex flex-col items-start gap-3 p-6 md:p-8">
      <h1 className="font-display text-2xl font-bold md:text-3xl">Check a ticket</h1>
      <p className="max-w-lg text-muted-foreground">
        Go to the <span className="font-semibold text-foreground">Tickets</span> tab and press{" "}
        <span className="font-semibold text-foreground">Check this ticket</span>. Ovelo will pay for the history
        report, run the risk rules, and show the result here.
      </p>
      <p className="text-xs text-muted-foreground">Demo tickets only.</p>
    </div>
  );
}

function LoadingState({ id }: { id: string }) {
  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">Demo Music Night 2026</p>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Checking {id}</h1>
      </div>
      <div className="card-surface flex items-center gap-3 p-6">
        <LoaderCircle className="size-5 shrink-0 animate-spin text-primary" />
        <div>
          <p className="font-semibold">Paying for the history report and running the risk rules…</p>
          <p className="mt-1 text-sm text-muted-foreground">
            This buys a real 0.01 USDC demo payment, then scores the ticket in code.
          </p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card-surface h-56 animate-pulse bg-muted/60" aria-hidden="true" />
        <div className="card-surface h-56 animate-pulse bg-muted/60" aria-hidden="true" />
      </div>
    </>
  );
}

function ErrorState({ check, onRun }: { check: Extract<CheckState, { status: "error" }>; onRun: (id: string) => void }) {
  return (
    <>
      <div>
        <p className="text-sm text-muted-foreground">Demo Music Night 2026</p>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Checking {check.id}</h1>
      </div>
      <div className="card-surface flex flex-col items-start gap-3 border-l-2 border-l-high p-6">
        <div className="flex items-center gap-2 font-semibold text-high">
          <TriangleAlert className="size-5" /> The check did not finish
        </div>
        <p className="text-sm text-muted-foreground">{check.message}</p>
        <button
          onClick={() => onRun(check.id)}
          className="mt-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          Try again
        </button>
      </div>
    </>
  );
}

function DoneCheck({
  check,
  onEscrowTx,
  fundedDeal,
}: {
  check: Extract<CheckState, { status: "done" }>;
  onEscrowTx: (txs: EscrowTx[]) => void;
  fundedDeal?: FundedDeal | null;
}) {
  const reportStep = check.steps.find((s) => s.tool === "get_ticket_history_report");
  const riskStep = check.steps.find((s) => s.tool === "check_ticket_risk");

  const report = reportStep?.result?.data;
  const payment = reportStep?.result?.payment;
  const reportOk = Boolean(report?.ticket);

  const riskPayload = riskStep && !riskStep.error ? riskStep.result : undefined;
  const risk = parseRiskResult(riskPayload);

  const reportProblem: string | null = reportOk
    ? null
    : reportStep?.error
      ? String(reportStep.result?.error ?? "The history report could not be bought.")
      : typeof report?.error === "string"
        ? String(report.error)
        : "The history report was not returned for this ticket.";

  const ticket = reportOk ? report.ticket : null;

  return (
    <>
      {/* Heading */}
      <div>
        {ticket && <p className="text-sm text-muted-foreground">{ticket.event} · {ticket.seat}</p>}
        <h1 className="font-display text-2xl font-bold break-words md:text-3xl">
          {ticket ? `Checking ${ticket.id} · $${ticket.askingPriceUsd}` : `Checking ${check.id}`}
        </h1>
      </div>

      {/* 1. The real risk result */}
      {risk ? (
        <RiskCard result={riskPayload} />
      ) : (
        <div className="card-surface flex items-start gap-3 p-6">
          <TriangleAlert className="mt-0.5 size-5 shrink-0 text-medium" />
          <div>
            <p className="font-semibold">No risk result came back for {check.id}.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask in the chat to check this ticket again.
            </p>
          </div>
        </div>
      )}

      {/* 1b. The real on-chain escrow flow, driven by the risk level from code */}
      {risk && (
        <EscrowPanel
          ticketId={risk.ticketId}
          riskLevel={risk.riskLevel}
          reasons={risk.reasons}
          onEscrowTx={onEscrowTx}
          initialDeal={fundedDeal}
        />
      )}

      {/* 2. The real payment receipt — only if a payment was actually signed */}
      {payment?.amount && (
        <div className="inline-flex flex-wrap items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm">
          <Receipt className="size-4 text-primary" />
          <span>
            Paid {payment.amount} for the ticket history report{" "}
            <span className="text-muted-foreground">(signed demo payment, not sent on-chain)</span>
          </span>
        </div>
      )}

      {/* Report problem, stated plainly */}
      {reportProblem && !risk && (
        <p className="text-sm text-muted-foreground">{reportProblem}</p>
      )}

      {/* 3 + 4. History timeline, issuer and owners, agent's explanation */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card-surface p-5 md:p-6">
          <h2 className="font-heading text-lg font-bold">History report</h2>
          {reportOk ? (
            <ol className="mt-5 space-y-5 border-l-2 border-border pl-6">
              {report.timeline.map((event: any, i: number) => {
                const label = TIMELINE_LABEL[event.type] ?? String(event.type);
                const active = event.type !== "not_scanned";
                return (
                  <li key={i} className="relative">
                    <span
                      className={cn(
                        "absolute -left-[31px] top-1 size-3.5 rounded-full border-2 border-card",
                        active ? "bg-primary" : "bg-border"
                      )}
                    />
                    <div className="font-semibold">{label}</div>
                    <div className="text-sm break-words text-muted-foreground">
                      {event.detail}
                      {event.when ? <span> · {event.when}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">{reportProblem}</p>
          )}
        </div>

        <div className="card-surface space-y-4 p-5 md:p-6">
          {reportOk ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">Issuer</span>
                <span className="flex items-center gap-2 font-medium">
                  <span className="break-words text-right">{report.issuer.name}</span>
                  {report.issuer.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-low-soft px-2 py-0.5 text-xs font-semibold text-low">
                      <BadgeCheck className="size-3.5" /> Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-high-soft px-2 py-0.5 text-xs font-semibold text-high">
                      <BadgeAlert className="size-3.5" /> Unverified
                    </span>
                  )}
                </span>
              </div>

              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Original face value</span>
                <span className="font-medium">${report.originalFaceValueUsd}</span>
              </div>

              <div className="flex items-start justify-between gap-3">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Users className="size-4" /> Owners so far
                </span>
                <span className="text-right font-medium">
                  {report.ownerCount}
                  <span className="block text-xs font-normal break-words text-muted-foreground">
                    {report.owners.join(" → ")}
                  </span>
                </span>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{reportProblem}</p>
          )}

          {check.answer && (
            <div className="rounded-xl bg-secondary p-4 text-sm text-secondary-foreground">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <Sparkles className="size-4" /> Ovelo says
              </div>
              <p className="whitespace-pre-wrap break-words">{check.answer}</p>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Demo tickets only. Every value above came from the tool results of this check.
      </p>
    </>
  );
}

/* ── 1b. The real on-chain escrow flow (Base Sepolia, test money) ── */

type FundResponse = {
  ok?: boolean;
  refused?: boolean;
  error?: string;
  message?: string;
  dealId?: string;
  runId?: string;
  status?: string;
  fundHash?: string;
  links?: { kind: "approve" | "fund" | "scan"; hash: string; url: string }[];
};

type ScanResponse = {
  ok?: boolean;
  rejected?: boolean;
  error?: string;
  message?: string;
  checkInHash?: string;
  link?: string;
  status?: string;
};

function EscrowPanel({
  ticketId,
  riskLevel,
  reasons,
  onEscrowTx,
  initialDeal,
}: {
  ticketId: string;
  riskLevel: RiskLevel;
  reasons: string[];
  onEscrowTx: (txs: EscrowTx[]) => void;
  initialDeal?: FundedDeal | null;
}) {
  const [busy, setBusy] = useState<false | "fund" | "scan">(false);
  const [error, setError] = useState<string | null>(null);
  const [deal, setDeal] = useState<{ dealId: string; runId: string; status: string } | null>(
    initialDeal ? { dealId: initialDeal.dealId, runId: initialDeal.runId, status: initialDeal.status } : null
  );
  const [fundLinks, setFundLinks] = useState<{ kind: string; hash: string; url: string }[]>(
    initialDeal?.links ?? []
  );
  const [scanLink, setScanLink] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);

  // If the deal was funded from the CHAT after this panel mounted, pick it up.
  useEffect(() => {
    if (!initialDeal || (!initialDeal.dealId && !initialDeal.runId)) return;
    setDeal((cur) => cur ?? { dealId: initialDeal.dealId, runId: initialDeal.runId, status: initialDeal.status });
    setFundLinks((cur) => (cur.length ? cur : initialDeal.links));
  }, [initialDeal]);

  async function fund() {
    setBusy("fund");
    setError(null);
    try {
      const res = await fetch("/api/escrow/fund", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, approved: riskLevel === "MEDIUM" }),
      });
      const data: FundResponse = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.ok === false) {
        setError(data.message ?? "Funding was refused.");
      } else if (data.ok && data.fundHash) {
        const links = data.links ?? [];
        if (data.dealId) {
          setDeal({ dealId: data.dealId, runId: data.runId ?? "", status: data.status ?? "Funded" });
        } else if (data.runId) {
          setDeal({ dealId: "", runId: data.runId, status: data.status ?? "Funded" });
        }
        setFundLinks(links);
        onEscrowTx(
          links.map((l) => ({
            kind: l.kind,
            hash: l.hash,
            url: l.url,
            ticketId,
            dealId: data.dealId ?? "",
            at: new Date().toISOString(),
          }))
        );
      }
    } catch {
      setError("Could not reach the server. Is the dev server still running?");
    } finally {
      setBusy(false);
    }
  }

  async function scan() {
    if (!deal) return;
    setBusy("scan");
    setError(null);
    setRejection(null);
    try {
      const body: any = deal.dealId ? { dealId: deal.dealId } : { runId: deal.runId, ticketId };
      const res = await fetch("/api/escrow/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data: ScanResponse = await res.json();
      if (data.error) {
        setError(data.error);
      } else if (data.ok && data.checkInHash && data.link) {
        setScanLink(data.link);
        setDeal({ ...deal, status: data.status ?? "Released" });
        onEscrowTx([
          { kind: "scan", hash: data.checkInHash, url: data.link, ticketId, dealId: deal.dealId, at: new Date().toISOString() },
        ]);
      } else {
        setRejection(data.message ?? "The gate rejected the scan.");
        if (data.status) setDeal({ ...deal, status: data.status });
      }
    } catch {
      setError("Could not reach the server. Is the dev server still running?");
    } finally {
      setBusy(false);
    }
  }

  // HIGH: never funded, no button.
  if (riskLevel === "HIGH") {
    return (
      <div className="card-surface flex flex-col gap-3 border-l-2 border-l-high p-5 md:p-6">
        <div className="flex items-center gap-2 font-semibold text-high">
          <Lock className="size-5" /> Blocked: funding refused
        </div>
        <p className="text-sm text-muted-foreground">
          Ovelo will not put money in escrow for a HIGH-risk ticket.
        </p>
        <ul className="flex flex-col gap-1.5 text-sm">
          {reasons.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 bg-high" aria-hidden="true" />
              <span className="min-w-0 break-words">{r}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Not funded yet: LOW shows a Fund button, MEDIUM an Approve button.
  if (!deal) {
    return (
      <div className="card-surface flex flex-col items-start gap-3 p-5 md:p-6">
        <h2 className="font-heading text-lg font-bold">Escrow</h2>
        <p className="text-sm text-muted-foreground">
          Hold 1 test USDC in escrow and release it to the seller when the ticket is scanned at the gate
          on Base Sepolia.
        </p>
        {riskLevel === "MEDIUM" && (
          <div className="flex items-start gap-2 rounded-xl bg-medium-soft p-3 text-sm text-medium">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span>MEDIUM risk: a person must approve before the agent funds this ticket.</span>
          </div>
        )}
        <button
          onClick={fund}
          disabled={busy === "fund"}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "fund" ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <ShieldCheck className="size-4" />
          )}
          {busy === "fund"
            ? "Funding on Base Sepolia…"
            : riskLevel === "MEDIUM"
              ? "Approve and fund escrow"
              : "Fund escrow"}
        </button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  // Funded (or released): show the deal and the demo gate.
  return (
    <div className="card-surface flex flex-col gap-4 p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-lg font-bold">Escrow</h2>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-xs font-semibold",
            deal.status === "Released" ? "bg-low-soft text-low" : "bg-medium-soft text-medium"
          )}
        >
          {deal.status}
        </span>
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-display text-3xl font-bold">1 test USDC</span>
        <span className="text-xs text-muted-foreground">
          Deadline 1 hour · demo prices are scaled down (real ticket prices are in USD)
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {fundLinks.map((l) => (
          <a
            key={l.hash}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
          >
            {l.kind} tx <ExternalLink className="size-3.5" />
          </a>
        ))}
      </div>

      {deal.status !== "Released" ? (
        <button
          onClick={scan}
          disabled={busy === "scan"}
          className="inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "scan" ? <LoaderCircle className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
          {busy === "scan" ? "Scanning…" : "Scan at gate (demo scanner)"}
        </button>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm font-semibold text-low">Released — the seller was paid 1 test USDC.</p>
          {scanLink && (
            <a
              href={scanLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-4"
            >
              check-in tx <ExternalLink className="size-3.5" />
            </a>
          )}
          <button
            onClick={scan}
            disabled={busy === "scan"}
            className="inline-flex w-fit items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy === "scan" ? <LoaderCircle className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
            {busy === "scan" ? "Scanning…" : "Scan again"}
          </button>
        </div>
      )}

      {rejection && (
        <div className="rounded-xl bg-high-soft p-3 text-sm text-high">
          <p className="font-semibold">Second scan rejected</p>
          <p className="mt-0.5 break-words">{rejection}</p>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
