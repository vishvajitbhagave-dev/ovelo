"use client";
/**
 * AGENT WALLET TAB — real values only.
 *
 * Reads the real agent address and its real Base Sepolia ETH and test USDC
 * balances from GET /api/escrow/status (server-side, no keys ever reach here),
 * and lists the escrow transactions made in this browser session with real
 * Basescan links. No sample address, no invented numbers.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, ShieldCheck, TimerReset, TriangleAlert, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EscrowTx } from "@/components/check-tab";

export type WalletInfo = { address: string | null; balance?: string; error?: string };

type EscrowStatus = {
  configured: boolean;
  address: string | null;
  eth: string;
  usdc: string;
  usdcBaseUnits: string;
  dealCount: number;
  maxTotalDeals: number;
  network: string;
  contract: string;
  explorer: string;
  error?: string;
};

type OpenDeal = {
  dealId: string;
  status: string;
  buyer: string;
  seller: string;
  amountUsdc: string;
  deadline: number;
  expired: boolean;
};

const TX_LABEL: Record<EscrowTx["kind"], string> = {
  approve: "Approve 1 USDC",
  fund: "Fund escrow",
  scan: "Scan at gate",
  refund: "Refund to agent",
};

function formatEth(val?: string | null) {
  if (!val || val === "0") return "0.000000";
  const n = Number(val);
  if (!isFinite(n)) return val;
  return n.toFixed(6);
}

function formatUsdc(val?: string | null) {
  if (!val || val === "0") return "0.00";
  const n = Number(val);
  if (!isFinite(n)) return val;
  return n.toFixed(2);
}

function timeLeft(deadline: number, now: number) {
  const secs = deadline - now;
  if (secs <= 0) return "expired";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  if (m <= 0) return `${s}s left`;
  return `${m}m ${s.toString().padStart(2, "0")}s left`;
}

export function WalletTab({
  wallet,
  creating,
  onCreate,
  onRefresh,
  escrowTxs,
  onEscrowTx,
}: {
  wallet: WalletInfo | null;
  creating: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  escrowTxs: EscrowTx[];
  onEscrowTx: (txs: EscrowTx[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<EscrowStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [openDeals, setOpenDeals] = useState<OpenDeal[]>([]);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundMsg, setRefundMsg] = useState<{ dealId: string; text: string; ok: boolean } | null>(null);
  const address = wallet?.address ?? status?.address ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/escrow/status");
      const data = await res.json();
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOpenDeals = useCallback(async () => {
    try {
      const res = await fetch("/api/escrow/open-deals");
      const data = await res.json();
      setOpenDeals(Array.isArray(data?.deals) ? data.deals : []);
    } catch {
      setOpenDeals([]);
    }
  }, []);

  useEffect(() => {
    load();
    loadOpenDeals();
  }, [load, loadOpenDeals]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);

  const refund = useCallback(
    async (deal: OpenDeal) => {
      setRefunding(deal.dealId);
      setRefundMsg(null);
      try {
        const res = await fetch("/api/escrow/refund", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dealId: deal.dealId }),
        });
        const data = await res.json();
        if (data?.ok) {
          setRefundMsg({
            dealId: deal.dealId,
            text: `Refunded ${formatUsdc(deal.amountUsdc)} test USDC to the agent wallet.`,
            ok: true,
          });
          onEscrowTx([
            {
              kind: "refund",
              hash: data.refundHash,
              url: data.link,
              ticketId: "refund",
              dealId: deal.dealId,
              at: new Date().toISOString(),
            },
          ]);
          onRefresh();
          await Promise.all([load(), loadOpenDeals()]);
        } else {
          setRefundMsg({ dealId: deal.dealId, text: data?.message ?? "The refund was refused.", ok: false });
        }
      } catch {
        setRefundMsg({ dealId: deal.dealId, text: "Could not reach the refund service.", ok: false });
      } finally {
        setRefunding(null);
      }
    },
    [load, loadOpenDeals, onRefresh, onEscrowTx]
  );

  // Refresh balances whenever a new escrow transaction happens this session.
  useEffect(() => {
    if (escrowTxs.length > 0) load();
  }, [escrowTxs.length, load]);

  function copy() {
    if (!address) return;
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold md:text-3xl">Agent wallet</h1>
        <p className="mt-1 text-muted-foreground">
          The wallet the agent signs with, and the escrow it uses — real values from Base Sepolia.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div className="card-surface p-5 md:p-6">
          {!address ? (
            <div className="flex flex-col items-start gap-3">
              <div className="text-sm text-muted-foreground">Address</div>
              <p className="text-sm text-muted-foreground">No wallet yet.</p>
              {wallet?.error && <p className="text-sm text-destructive">{wallet.error}</p>}
              <Button onClick={onCreate} disabled={creating} className="w-fit font-mono tracking-wider uppercase">
                <WalletIcon /> {creating ? "Creating…" : "Create wallet"}
              </Button>
              <p className="text-xs text-muted-foreground">
                On a host with a read-only file system (for example Vercel), set{" "}
                <code className="rounded bg-muted px-1">WALLET_PRIVATE_KEY</code> in the environment variables
                instead of using this button.
              </p>
            </div>
          ) : (
            <>
              <div className="text-sm text-muted-foreground">Address</div>
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <code className="font-mono text-base font-semibold break-all">{address}</code>
                <button
                  onClick={copy}
                  aria-label="Copy address"
                  className="rounded-lg border p-2 transition hover:bg-muted"
                >
                  {copied ? <Check className="size-4 text-low" /> : <Copy className="size-4" />}
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <span className="text-sm text-muted-foreground">Balances (Base Sepolia)</span>
                <button
                  onClick={() => {
                    onRefresh();
                    load();
                  }}
                  aria-label="Refresh balances"
                  className="rounded-lg border p-1.5 transition hover:bg-muted"
                >
                  <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
              <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:gap-4">
                <div className="flex-1 min-w-0">
                  <div
                    className="font-display text-xl font-bold sm:text-2xl md:text-2xl truncate"
                    title={status?.eth ?? "—"}
                  >
                    {formatEth(status?.eth)}
                  </div>
                  <div className="text-xs text-muted-foreground">ETH (gas)</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className="font-display text-xl font-bold sm:text-2xl md:text-2xl truncate"
                    title={status?.usdc ?? "—"}
                  >
                    {formatUsdc(status?.usdc)}
                  </div>
                  <div className="text-xs text-muted-foreground">test USDC</div>
                </div>
              </div>

              {status && status.dealCount >= 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Demo deals opened so far: {status.dealCount} of {status.maxTotalDeals}.
                </p>
              )}

              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
                <a
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                  href={`https://sepolia.basescan.org/address/${address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Explorer <ExternalLink className="size-3.5" />
                </a>
                <a
                  className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
                  href="https://docs.base.org/base-chain/tools/network-faucets"
                  target="_blank"
                  rel="noreferrer"
                >
                  Get test ETH <ExternalLink className="size-3.5" />
                </a>
              </div>
            </>
          )}
        </div>

        <div className="card-surface flex flex-col p-5 md:p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" />
            <h2 className="font-heading text-lg font-bold">Escrow transactions (this session)</h2>
          </div>

          {escrowTxs.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              No escrow transactions yet. Fund a LOW-risk ticket on the Check tab, then scan it at the demo gate.
              They will appear here with real Basescan links.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y">
              {escrowTxs.map((tx) => (
                <li key={`${tx.kind}-${tx.hash}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">{TX_LABEL[tx.kind]}</div>
                    <div className="truncate font-mono text-xs text-muted-foreground">
                      {tx.ticketId}
                      {tx.dealId ? ` · deal ${tx.dealId}` : ""}
                    </div>
                  </div>
                  <a
                    href={tx.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-primary underline underline-offset-4"
                  >
                    tx <ExternalLink className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Test network and test money only. The demo uses one shared agent wallet and a trusted demo scanner.
          </p>
        </div>
      </div>

      {openDeals.length > 0 && (
        <div className="card-surface p-5 md:p-6">
          <div className="flex items-center gap-2">
            <TimerReset className="size-5 text-primary" />
            <h2 className="font-display text-lg font-bold">Open deals</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Funded deals the agent has not scanned yet. Once a deal&apos;s deadline passes, the 1 test USDC it holds
            can be refunded to the agent wallet.
          </p>
          <ul className="mt-3 flex flex-col divide-y">
            {openDeals.map((deal) => (
              <li key={deal.dealId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    Deal {deal.dealId} · {formatUsdc(deal.amountUsdc)} test USDC
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {deal.expired ? "Deadline passed — refund available" : timeLeft(deal.deadline, now)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!deal.expired || refunding === deal.dealId}
                    onClick={() => refund(deal)}
                    className="font-mono tracking-wider uppercase"
                  >
                    {refunding === deal.dealId ? "Refunding…" : deal.expired ? "Refund" : "Not yet"}
                  </Button>
                  {refundMsg?.dealId === deal.dealId && (
                    <span className={`text-xs ${refundMsg.ok ? "text-low" : "text-destructive"}`}>
                      {refundMsg.text}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
