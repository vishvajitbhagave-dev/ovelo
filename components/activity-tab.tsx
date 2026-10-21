"use client";
/**
 * ACTIVITY TAB
 *
 * A plain-words log of what the agent did in this browser session: every risk
 * check, paid report, escrow funding, refusal, scan, rejection, refund, ticket
 * comparison and deal lookup. One entry per event, newest first.
 *
 * Every entry is built from real data the app already has. If a value is not
 * available it is left out rather than guessed. The log is in memory only and
 * resets when the page is refreshed.
 */
import { useCallback, useEffect, useState } from "react";
import { Activity as ActivityIcon, ExternalLink, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityEvent, ActivityOutcome } from "@/lib/activity";

type EscrowStatus = {
  address: string | null;
  eth: string;
  usdc: string;
  dealCount: number;
  maxTotalDeals: number;
  contract: string;
};

const OUTCOME_STYLE: Record<ActivityOutcome, { label: string; badge: string }> = {
  done: { label: "Done", badge: "bg-low-soft text-low" },
  refused: { label: "Refused", badge: "bg-high-soft text-high" },
  waiting: { label: "Waiting", badge: "bg-medium-soft text-medium" },
};

function formatEth(val?: string | null) {
  if (!val || val === "0") return "0.000000";
  const n = Number(val);
  return isFinite(n) ? n.toFixed(6) : val;
}

function formatUsdc(val?: string | null) {
  if (!val || val === "0") return "0.00";
  const n = Number(val);
  return isFinite(n) ? n.toFixed(2) : val;
}

function shorten(address?: string | null) {
  if (!address) return "";
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function timeLabel(at: string) {
  const d = new Date(at);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString();
}

export function ActivityTab({ activity }: { activity: ActivityEvent[] }) {
  const [status, setStatus] = useState<EscrowStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/escrow/status");
      const data = await res.json();
      setStatus(data && typeof data === "object" ? data : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const events = [...activity].reverse();

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Activity</h1>
        <p className="mt-1 text-muted-foreground">
          Everything Ovelo decided and paid for in this session, in plain words.
        </p>
      </div>

      {/* Summary line: real balances and the demo deal cap. */}
      <div className="card-surface flex flex-wrap items-center justify-between gap-3 p-4 md:p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="text-muted-foreground">Agent balance</span>
          <span className="font-semibold">{loading && !status ? "…" : formatEth(status?.eth)} ETH</span>
          <span className="font-semibold">{loading && !status ? "…" : formatUsdc(status?.usdc)} test USDC</span>
          <span className="text-muted-foreground">
            deals opened {status ? status.dealCount : "—"} of {status ? status.maxTotalDeals : "—"}
          </span>
        </div>
        <button
          onClick={load}
          aria-label="Refresh activity summary"
          className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-muted"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
        </button>
      </div>

      {events.length === 0 ? (
        <div className="card-surface flex flex-col items-start gap-2 p-6 md:p-8">
          <div className="flex items-center gap-2 font-semibold">
            <ActivityIcon className="size-5 text-primary" /> No activity yet. Check a ticket to start.
          </div>
          <p className="text-sm text-muted-foreground">
            Risk checks, payments, escrow funding, scans and refunds will show up here.
          </p>
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {events.map((event) => (
            <ActivityRow key={event.id} event={event} status={status} />
          ))}
        </ol>
      )}

      <p className="text-xs text-muted-foreground">
        This log lives in memory for this session and resets when the page is refreshed.
      </p>
    </section>
  );
}

function ActivityRow({ event, status }: { event: ActivityEvent; status: EscrowStatus | null }) {
  const style = OUTCOME_STYLE[event.outcome];
  const recipient =
    event.counterparty === "escrow"
      ? { address: status?.contract, label: "escrow contract" }
      : event.counterparty === "agent"
        ? { address: status?.address, label: "agent wallet" }
        : event.counterparty === "apiOwner"
          ? { address: event.counterpartyAddress, label: "API owner" }
          : null;

  return (
    <li className="card-surface p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{timeLabel(event.at)}</span>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", style.badge)}>{style.label}</span>
      </div>
      <p className="mt-1.5 text-sm font-semibold break-words">{event.title}</p>
      {event.reason && <p className="mt-1 text-sm break-words text-muted-foreground">{event.reason}</p>}
      {(event.amount || event.url || recipient) && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {event.amount && (
            <span className="font-medium">
              {event.amount} test USDC
              {event.amountNote && (
                <span
                  className={cn(
                    "font-normal",
                    event.verified === false ? "text-medium" : "text-muted-foreground"
                  )}
                >
                  {" "}({event.amountNote})
                </span>
              )}
              {event.verified === false && (
                <TriangleAlert
                  className="ml-1 inline size-3 align-middle text-medium"
                  aria-hidden="true"
                />
              )}
            </span>
          )}
          {recipient && (
            <span className="text-muted-foreground">
              to {recipient.label}{" "}
              <span className="font-mono text-foreground" title={recipient.address ?? ""}>
                {recipient.address ? shorten(recipient.address) : "…"}
              </span>
            </span>
          )}
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
            >
              view tx <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      )}
    </li>
  );
}
