"use client";
/**
 * AGENT WALLET TAB — a deliberately simple placeholder.
 *
 * Shows only real values returned by GET /api/wallet: the actual address and
 * the actual Base Sepolia ETH balance. No sample address, no invented USDC
 * balance, no payment history, no spending limit.
 */
import { useState } from "react";
import { Check, Copy, ExternalLink, RefreshCw, ShieldCheck, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type WalletInfo = { address: string | null; balance?: string; error?: string };

export function WalletTab({
  wallet,
  creating,
  onCreate,
  onRefresh,
}: {
  wallet: WalletInfo | null;
  creating: boolean;
  onCreate: () => void;
  onRefresh: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const address = wallet?.address ?? null;

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
        <p className="mt-1 text-muted-foreground">The wallet the agent signs its paid API calls with.</p>
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
                On a host with a read-only file system (for example Vercel), set <code className="rounded bg-muted px-1">WALLET_PRIVATE_KEY</code>{" "}
                in the environment variables instead of using this button.
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

              <div className="mt-4 text-sm text-muted-foreground">Network</div>
              <div className="font-medium">Base Sepolia (test network)</div>

              {wallet?.balance && (
                <>
                  <div className="mt-4 flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Balance</span>
                    <button
                      onClick={onRefresh}
                      aria-label="Refresh balance"
                      className="rounded-lg border p-1.5 transition hover:bg-muted"
                    >
                      <RefreshCw className="size-3.5" />
                    </button>
                  </div>
                  <div className="font-display text-3xl font-bold">{wallet.balance}</div>
                </>
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

        <div className="card-surface flex flex-col justify-center bg-secondary p-5 md:p-6">
          <ShieldCheck className="size-8 text-primary" />
          <div className="mt-3 text-sm font-semibold tracking-wide text-muted-foreground uppercase">Coming next</div>
          <p className="mt-1 text-xl font-bold text-primary">More wallet features arrive in the next round.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Right now this tab only shows what the agent's wallet really is. Nothing else here is built yet.
          </p>
        </div>
      </div>
    </section>
  );
}
