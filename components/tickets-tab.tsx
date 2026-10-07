"use client";
/**
 * TICKETS TAB
 *
 * Shows the six real demo tickets from agent/tickets.ts, fetched from the
 * read-only GET /api/tickets route (an explicit field allowlist — this tab
 * never sees risk levels, owners or issuers).
 */
import { useEffect, useState } from "react";
import { Ticket as TicketIcon, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type TicketListItem = {
  id: string;
  event: string;
  seat: string;
  sellerName: string;
  askingPriceUsd: number;
};

type TicketsPayload = { event?: string; count?: number; tickets?: TicketListItem[] };

export function TicketsTab({ onCheck, busyId }: { onCheck: (id: string) => void; busyId: string | null }) {
  const [payload, setPayload] = useState<TicketsPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/tickets")
      .then((r) => r.json())
      .then((data: TicketsPayload) => {
        if (alive) setPayload(data);
      })
      .catch(() => {
        if (alive) setError(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="card-surface flex items-start gap-3 p-6">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-high" />
        <div>
          <p className="font-semibold">Could not load the tickets.</p>
          <p className="mt-1 text-sm text-muted-foreground">Refresh the page and try again.</p>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="card-surface h-44 animate-pulse bg-muted/60 p-5" />
        ))}
      </div>
    );
  }

  const tickets = payload.tickets ?? [];

  return (
    <section>
      <h1 className="font-display text-2xl font-bold md:text-3xl">{payload.event}</h1>
      <p className="mt-1 text-muted-foreground">
        {tickets.length} resale tickets listed. Pick one to check before you pay.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tickets.map((t) => {
          const busy = busyId === t.id;
          return (
            <article key={t.id} className="card-surface flex flex-col p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-primary">
                  <TicketIcon className="size-4 shrink-0" />
                  <span className="truncate">{t.id}</span>
                </span>
                <span className="font-display text-2xl font-bold">${t.askingPriceUsd}</span>
              </div>
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Seat</dt>
                  <dd className="text-right font-medium">{t.seat}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Seller</dt>
                  <dd className="text-right font-medium">{t.sellerName}</dd>
                </div>
              </dl>
              <button
                onClick={() => onCheck(t.id)}
                disabled={busy}
                className={cn(
                  "mt-5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90",
                  "disabled:cursor-not-allowed disabled:opacity-60"
                )}
              >
                {busy ? "Checking…" : "Check this ticket"}
              </button>
            </article>
          );
        })}
      </div>

      <p className="mt-6 text-xs text-muted-foreground">
        Demo tickets only. These tickets are fake and nothing here can check a real ticket, seller or event.
      </p>
    </section>
  );
}
