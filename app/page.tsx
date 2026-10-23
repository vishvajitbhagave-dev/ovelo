"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import {
  Bot,
  ChevronRight,
  CircleAlert,
  MessageCircle,
  RotateCcw,
  SendHorizontal,
  Wallet,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RiskCard } from "@/components/risk-card";
import { TicketsTab } from "@/components/tickets-tab";
import { CheckTab, type CheckState, type EscrowTx, type FundedDeal, type Step } from "@/components/check-tab";
import { WalletTab, type WalletInfo } from "@/components/wallet-tab";
import { ActivityTab } from "@/components/activity-tab";
import { activityFromSteps, type ActivityEvent } from "@/lib/activity";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "agent"; text: string; steps?: Step[]; error?: boolean; model?: string };
type ModelOption = { id: string; name: string; note: string };
type Status = {
  hasApiKey: boolean;
  model: string;
  defaultModel?: string;
  models?: ModelOption[];
  tools: { name: string; description: string }[];
};
type AgentResponse = { answer?: string; steps?: Step[]; error?: string; model?: string };
type Tab = "tickets" | "check" | "activity" | "wallet";

const TABS: { id: Tab; label: string }[] = [
  { id: "tickets", label: "Tickets" },
  { id: "check", label: "Check" },
  { id: "activity", label: "Activity" },
  { id: "wallet", label: "Agent wallet" },
];

const EXAMPLES = ["What's the weather in Mumbai?", "What's in your wallet?", "Roll a 20 sided dice"];

export default function Home() {
  const [status, setStatus] = useState<Status | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<Tab>("tickets");
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [chatOpen, setChatOpen] = useState(false);
  const [model, setModel] = useState("");
  const [escrowTxs, setEscrowTxs] = useState<EscrowTx[]>([]);
  const [fundedDeals, setFundedDeals] = useState<Record<string, FundedDeal>>({});
  const [activity, setActivity] = useState<ActivityEvent[]>([]);

  const loadWallet = () => fetch("/api/wallet").then((r) => r.json()).then(setWallet);

  /** Append real activity events (chat tool steps or button actions) to the session log. */
  const logActivity = (events: ActivityEvent[]) => {
    if (events.length) setActivity((prev) => [...prev, ...events]);
  };

  useEffect(() => {
    fetch("/api/agent").then((r) => r.json()).then(setStatus);
    loadWallet();
  }, []);

  async function createWallet() {
    setCreating(true);
    const res = await fetch("/api/wallet", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
      setWallet((w) => ({ address: null, ...w, error: data.error }));
      setCreating(false);
      return;
    }
    await loadWallet();
    setCreating(false);
  }

  /**
   * One place that talks to the agent. Used by the chat input and by the
   * Check tab, so both produce the same transcript and the same wallet refresh.
   */
  async function ask(text: string): Promise<AgentResponse> {
    const history: Message[] = [...messages, { role: "user", text }];
    setMessages(history);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.filter((m) => !m.error).map(({ role, text }) => ({ role, text })),
          model: model || undefined,
        }),
      });
      const data: AgentResponse = await res.json();
      setMessages((m) => [
        ...m,
        data.error
          ? { role: "agent", text: data.error, error: true }
          : { role: "agent", text: data.answer ?? "", steps: data.steps, model: data.model },
      ]);
      logActivity(activityFromSteps(data.steps));
      if (data.steps?.some((s) => s.result?.payment)) loadWallet();

      // Learn from escrows the agent funded in the CHAT: add their real
      // transactions to the session list and remember the deal per ticket so the
      // Check tab can show it and scan it at the gate (same as the button flow).
      const fundedSteps = (data.steps ?? []).filter(
        (s) => s.tool === "fund_escrow" && (s.result as { ok?: boolean } | undefined)?.ok === true
      );
      if (fundedSteps.length > 0) {
        const newTxs: EscrowTx[] = [];
        const additions: Record<string, FundedDeal> = {};
        for (const s of fundedSteps) {
          const r = (s.result ?? {}) as {
            ticketId?: string;
            dealId?: string;
            runId?: string;
            links?: FundedDeal["links"];
          };
          const ticketId = String((s.args as { ticketId?: string } | undefined)?.ticketId ?? r.ticketId ?? "");
          for (const l of r.links ?? []) {
            newTxs.push({
              kind: l.kind,
              hash: l.hash,
              url: l.url,
              ticketId,
              dealId: r.dealId ?? "",
              at: new Date().toISOString(),
            });
          }
          if (ticketId) {
            additions[ticketId] = {
              dealId: r.dealId ?? "",
              runId: r.runId ?? "",
              status: "Funded",
              links: r.links ?? [],
            };
          }
        }
        if (newTxs.length > 0) {
          setEscrowTxs((prev) => {
            const seen = new Set(prev.map((t) => t.hash));
            return [...prev, ...newTxs.filter((t) => !seen.has(t.hash))];
          });
        }
        if (Object.keys(additions).length > 0) {
          setFundedDeals((prev) => ({ ...prev, ...additions }));
        }
      }
      return data;
    } catch {
      const error = "Could not reach the server. Is the dev server still running?";
      setMessages((m) => [...m, { role: "agent", text: error, error: true }]);
      return { error };
    }
  }

  async function send(text: string) {
    if (!text.trim() || thinking || check.status === "loading") return;
    setInput("");
    setThinking(true);
    await ask(text);
    setThinking(false);
  }

  /** "Check this ticket" -> the real paid flow, results land on the Check tab. */
  async function runCheck(id: string) {
    if (check.status === "loading" || thinking) return;
    setTab("check");
    setCheck({ status: "loading", id });
    const data = await ask(`Check ticket ${id}`);
    if (data.error || !data.steps) {
      setCheck({ status: "error", id, message: data.error ?? "The agent returned no result." });
    } else {
      setCheck({ status: "done", id, answer: data.answer ?? "", steps: data.steps });
    }
  }

  const ready = Boolean(status?.hasApiKey);
  const busy = thinking || check.status === "loading";

  const chatProps: ChatPanelProps = {
    status,
    ready,
    wallet,
    creating,
    messages,
    thinking,
    input,
    busy,
    models: status?.models ?? [],
    model,
    defaultModel: status?.defaultModel ?? status?.model ?? "",
    setModel,
    setInput,
    send,
    createWallet,
    clear: () => setMessages([]),
  };

  return (
    <div className="min-h-screen">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 md:h-16 md:flex-nowrap md:px-8">
          <span className="font-display text-2xl font-extrabold text-primary">Ovelo</span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-medium-soft px-3 py-1 text-xs font-semibold text-medium">
              Demo mode · fake tickets only
            </span>
            <WalletChip wallet={wallet} />
          </div>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[1fr_360px]">
        {/* ── Main column ── */}
        <main className="px-4 pt-6 pb-28 md:px-8 lg:pb-10">
          <nav className="mb-6 inline-flex max-w-full rounded-full bg-muted p-1" aria-label="Sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition",
                  tab === t.id ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "tickets" && <TicketsTab onCheck={runCheck} busyId={check.status === "loading" ? check.id : null} />}
          {tab === "check" && (
            <CheckTab
              check={check}
              onRun={runCheck}
              onEscrowTx={(txs) => setEscrowTxs((prev) => [...prev, ...txs])}
              onActivity={logActivity}
              fundedDeal={check.status === "done" ? fundedDeals[check.id] ?? null : null}
            />
          )}
          {tab === "activity" && <ActivityTab activity={activity} />}
          {tab === "wallet" && (
            <WalletTab
              wallet={wallet}
              creating={creating}
              onCreate={createWallet}
              onRefresh={loadWallet}
              escrowTxs={escrowTxs}
              onEscrowTx={(txs) => setEscrowTxs((prev) => [...prev, ...txs])}
              onActivity={logActivity}
            />
          )}
        </main>

        {/* ── Chat, side panel on desktop ── */}
        <aside className="sticky top-[65px] hidden h-[calc(100vh-65px)] overflow-hidden border-l bg-card lg:block">
          <ChatPanel {...chatProps} />
        </aside>
      </div>

      {/* ── Chat, bottom sheet on phones ── */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed right-5 bottom-5 z-30 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 font-semibold text-primary-foreground shadow-lg lg:hidden"
      >
        <MessageCircle className="size-5" /> Ask Ovelo
      </button>

      {chatOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-foreground/30" onClick={() => setChatOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 h-[75vh] animate-in overflow-hidden rounded-t-3xl bg-card pb-[env(safe-area-inset-bottom)] slide-in-from-bottom">
            <button
              onClick={() => setChatOpen(false)}
              aria-label="Close chat"
              className="absolute top-4 right-4 z-10 rounded-full p-1.5 hover:bg-muted"
            >
              <X className="size-5" />
            </button>
            <ChatPanel {...chatProps} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Header: the real wallet address, shortened ── */
function WalletChip({ wallet }: { wallet: WalletInfo | null }) {
  if (!wallet?.address) {
    return (
      <span className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
        {wallet === null ? "…" : "No wallet yet"}
      </span>
    );
  }
  const short = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
  return (
    <span className="flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs">
      <span className="size-2 rounded-full bg-low" />
      <span className="font-mono font-semibold">{short}</span>
      <span className="hidden text-muted-foreground sm:inline">Base Sepolia test network</span>
    </span>
  );
}

/* ── Chat panel: used by the desktop aside and the mobile sheet ── */
type ChatPanelProps = {
  status: Status | null;
  ready: boolean;
  wallet: WalletInfo | null;
  creating: boolean;
  messages: Message[];
  thinking: boolean;
  input: string;
  busy: boolean;
  models: ModelOption[];
  model: string;
  defaultModel: string;
  setModel: (v: string) => void;
  setInput: (v: string) => void;
  send: (text: string) => Promise<void>;
  createWallet: () => void;
  clear: () => void;
};

function ChatPanel(props: ChatPanelProps) {
  const { status, ready, wallet, creating, messages, thinking, input, busy, models, model, defaultModel, setModel, setInput, send, createWallet, clear } = props;
  const needsWallet = Boolean(status) && ready && wallet !== null && !wallet.address;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start justify-between gap-2 border-b px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-heading text-lg font-bold">Ask Ovelo</h2>
          <p className="text-xs text-muted-foreground">Your ticket safety helper</p>
          <ModelPicker models={models} value={model || defaultModel} onChange={setModel} disabled={!models.length} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={messages.length === 0 || busy}
          aria-label="Clear chat"
          className="shrink-0"
        >
          <RotateCcw /> Clear
        </Button>
      </div>

      {/* Setup: only when something is actually missing */}
      {(!ready || needsWallet) && (
        <div className="flex shrink-0 flex-col gap-3 border-b bg-muted/40 px-5 py-4 text-sm">
          {!ready && status && (
            <p className="text-muted-foreground">
              Add your Gemini API key to <code className="rounded bg-muted px-1">.env</code> as{" "}
              <code className="rounded bg-muted px-1">GEMINI_API_KEY</code>, then restart the server.{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer"
              >
                Get a free key
              </a>
            </p>
          )}
          {needsWallet && (
            <div className="flex flex-col items-start gap-2">
              {wallet?.error && <p className="text-destructive">{wallet.error}</p>}
              <p className="text-muted-foreground">The agent signs paid API calls with its own wallet.</p>
              <Button onClick={createWallet} disabled={creating} className="w-fit">
                <Wallet /> {creating ? "Creating…" : "Create wallet"}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tools */}
      {status?.tools?.length ? (
        <Collapsible className="shrink-0 border-b">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold hover:bg-muted/60">
            <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
            Tools <span className="text-muted-foreground">({status.tools.length})</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="max-h-[45vh] overflow-y-auto border-t">
            <div className="flex flex-col gap-2 px-5 py-4">
              {status.tools.map((t) => (
                <ToolInfo key={t.name} name={t.name} description={t.description} />
              ))}
              <p className="border-t pt-3 text-xs text-muted-foreground">
                Add your own in <code className="rounded bg-muted px-1">agent/tools.ts</code>.
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {/* Messages */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 px-5 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-5 py-10 text-center">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                <Bot className="size-5" />
              </div>
              <div>
                <p className="font-heading text-xl font-bold">Ask Ovelo something</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {!ready
                    ? "Add your Gemini API key to start."
                    : needsWallet
                      ? "Create a wallet first so the agent can pay for the history report."
                      : "Try an example, or ask about a ticket."}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {EXAMPLES.map((e) => (
                  <Button key={e} variant="outline" onClick={() => send(e)} disabled={!ready || busy} className="justify-start font-normal">
                    {e}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm font-medium break-words text-primary-foreground [overflow-wrap:anywhere]">
                {m.text}
              </div>
            ) : (
              <div key={i} className="flex max-w-[92%] flex-col gap-2 self-start">
                {m.steps?.map((s, j) => (
                  <Fragment key={j}>
                    <ToolCall step={s} />
                    {s.tool === "check_ticket_risk" && <RiskCard result={s.result} />}
                  </Fragment>
                ))}
                <div
                  className={cn(
                    "max-w-full min-w-0 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm [overflow-wrap:anywhere]",
                    m.error ? "bg-high-soft text-high" : "bg-muted"
                  )}
                >
                  {m.error ? (
                    <>
                      <CircleAlert className="mr-1 inline size-4" />
                      {m.text}
                    </>
                  ) : (
                    <Markdown text={m.text} />
                  )}
                </div>
                {m.model && (
                  <p className="px-1 font-mono text-[10px] text-muted-foreground">{m.model}</p>
                )}
              </div>
            )
          )}

          {thinking && (
            <p className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
              agent is thinking <span className="inline-block h-4 w-2 animate-pulse bg-primary" />
            </p>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="shrink-0 border-t p-4">
        <form
          className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={ready ? "Ask about a ticket…" : "add your Gemini API key to start"}
            disabled={!ready}
            className="h-auto flex-1 border-0 bg-transparent p-0 focus-visible:ring-0 disabled:opacity-100"
          />
          <button
            type="submit"
            disabled={!ready || busy || !input.trim()}
            aria-label="Send"
            className="rounded-lg p-1.5 text-muted-foreground transition hover:text-primary disabled:opacity-40"
          >
            <SendHorizontal className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── Model switcher: picks one of the server's allowlisted models ── */
function ModelPicker({
  models,
  value,
  onChange,
  disabled,
}: {
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (!models.length) return null;
  const current = models.find((m) => m.id === value) ?? models[0];
  return (
    <label className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" title={current.note}>
      <span className="shrink-0">Model</span>
      <select
        value={current.id}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label="Choose a model"
        className="max-w-[11rem] truncate rounded-lg border bg-background px-2 py-1 text-xs font-medium text-foreground disabled:opacity-60"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ── One tool step: expandable, with the real Paid badge ── */
function ToolCall({ step }: { step: Step }) {
  const payment = step.result?.payment;
  const reused = step.result?.reused === true;
  const reusedBlock = step.result?.blockNumber;
  const reusedTxHash = step.result?.reusedFromTxHash;
  // The payment object is only presented as a verified settlement when OUR code
  // read the transaction receipt back from the chain. Otherwise the facilitator
  // reported it as paid, but Ovelo could not confirm the money moved — say so.
  // A reused report is never presented as a new payment.
  const paidVerified = !reused && Boolean(payment) && payment.verified === true;
  const paidUnverified = !reused && Boolean(payment) && payment.verified !== true;
  return (
    <Collapsible className="w-full overflow-hidden rounded-xl border bg-card font-mono text-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        <span className="text-muted-foreground uppercase">Tool</span>
        <span className="truncate text-primary">{step.tool}</span>
        {reused && (
          <Badge
            className="ml-auto bg-muted font-mono uppercase"
            title={
              reusedTxHash
                ? `Original transaction ${reusedTxHash}${reusedBlock ? ` · block ${reusedBlock}` : ""}`
                : "Reused from a recent paid report"
            }
          >
            Reused report (no new payment)
          </Badge>
        )}
        {paidVerified && (
          <Badge className="ml-auto bg-low-soft font-mono text-low uppercase">
            Paid {payment.amount} · verified
          </Badge>
        )}
        {paidUnverified && (
          <Badge className="ml-auto bg-medium-soft font-mono text-medium uppercase" title={payment.verifyReason}>
            Paid {payment.amount} · not verified
          </Badge>
        )}
        {step.error && !payment && <Badge variant="destructive" className="ml-auto font-mono uppercase">Failed</Badge>}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2 border-t px-3 py-2">
        <Json label="Input" value={step.args} />
        <Json label="Output" value={step.result} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function Json({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-muted-foreground uppercase">{label}</p>
      <pre className="overflow-x-auto rounded-lg bg-muted p-2">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

/* ── One row in the Tools list: name + cost badge + 2-line clamp with "more" ── */
function toolBadge(name: string): { label: string; variant: "secondary" | "default"; className: string } {
  if (name === "fund_escrow") {
    return { label: "on-chain", variant: "default", className: "" };
  }
  if (name === "get_weather" || name === "get_ticket_history_report") {
    return { label: "x402 paid", variant: "default", className: "bg-blue text-white" };
  }
  return { label: "free", variant: "secondary", className: "" };
}

function ToolInfo({ name, description }: { name: string; description: string }) {
  const [expanded, setExpanded] = useState(false);
  const badge = toolBadge(name);
  const canClamp = description.length > 90;
  const clamped = canClamp && !expanded;

  return (
    <div className="rounded-xl border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-xs">
          <span className="text-primary">&gt;</span> {name}
        </p>
        <Badge variant={badge.variant} className={cn("shrink-0", badge.className)}>
          {badge.label}
        </Badge>
      </div>
      <p className={cn("mt-1 text-xs text-muted-foreground", clamped && "line-clamp-2")}>{description}</p>
      {canClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-semibold text-primary hover:underline"
        >
          {expanded ? "less" : "more"}
        </button>
      )}
    </div>
  );
}
