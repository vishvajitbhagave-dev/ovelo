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
import { useState } from "react";
import { BadgeAlert, BadgeCheck, LoaderCircle, Lock, Receipt, Sparkles, TriangleAlert, Users } from "lucide-react";
import { RiskCard, parseRiskResult } from "@/components/risk-card";
import { cn } from "@/lib/utils";

export type Step = { tool: string; args: unknown; result: any; error?: boolean };

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

export function CheckTab({ check, onRun }: { check: CheckState; onRun: (id: string) => void }) {
  return (
    <section className="space-y-5">
      {check.status === "idle" && <IdleState />}
      {check.status === "loading" && <LoadingState id={check.id} />}
      {check.status === "error" && <ErrorState check={check} onRun={onRun} />}
      {check.status === "done" && <DoneCheck check={check} />}

      {/* Not built yet — kept disabled on purpose */}
      <button
        disabled
        aria-disabled="true"
        className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl bg-muted px-5 py-3 font-semibold text-muted-foreground"
      >
        <Lock className="size-4" /> Fund escrow (coming soon)
      </button>
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

function DoneCheck({ check }: { check: Extract<CheckState, { status: "done" }> }) {
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
