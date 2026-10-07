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
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RiskCard } from "@/components/risk-card";
import { TicketsTab } from "@/components/tickets-tab";
import { CheckTab, type CheckState, type Step } from "@/components/check-tab";
import { WalletTab, type WalletInfo } from "@/components/wallet-tab";
import { cn } from "@/lib/utils";

type Message = { role: "user" | "agent"; text: string; steps?: Step[]; error?: boolean };
type Status = { hasApiKey: boolean; model: string; tools: { name: string; description: string }[] };
type AgentResponse = { answer?: string; steps?: Step[]; error?: string };
type Tab = "tickets" | "check" | "wallet";

const TABS: { id: Tab; label: string }[] = [
  { id: "tickets", label: "Tickets" },
  { id: "check", label: "Check" },
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

  const loadWallet = () => fetch("/api/wallet").then((r) => r.json()).then(setWallet);

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
        body: JSON.stringify({ messages: history.filter((m) => !m.error).map(({ role, text }) => ({ role, text })) }),
      });
      const data: AgentResponse = await res.json();
      setMessages((m) => [
        ...m,
        data.error
          ? { role: "agent", text: data.error, error: true }
          : { role: "agent", text: data.answer ?? "", steps: data.steps },
      ]);
      if (data.steps?.some((s) => s.result?.payment)) loadWallet();
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
          {tab === "check" && <CheckTab check={check} onRun={runCheck} />}
          {tab === "wallet" && (
            <WalletTab wallet={wallet} creating={creating} onCreate={createWallet} onRefresh={loadWallet} />
          )}
        </main>

        {/* ── Chat, side panel on desktop ── */}
        <aside className="sticky top-[65px] hidden h-[calc(100vh-65px)] border-l bg-card lg:block">
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
          <div className="absolute inset-x-0 bottom-0 h-[75vh] animate-in rounded-t-3xl bg-card slide-in-from-bottom">
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
  setInput: (v: string) => void;
  send: (text: string) => Promise<void>;
  createWallet: () => void;
  clear: () => void;
};

function ChatPanel(props: ChatPanelProps) {
  const { status, ready, wallet, creating, messages, thinking, input, busy, setInput, send, createWallet, clear } = props;
  const needsWallet = Boolean(status) && ready && wallet !== null && !wallet.address;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b px-5 py-4">
        <div>
          <h2 className="font-heading text-lg font-bold">Ask Ovelo</h2>
          <p className="text-xs text-muted-foreground">Your ticket safety helper</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={messages.length === 0 || busy}
          aria-label="Clear chat"
        >
          <RotateCcw /> Clear
        </Button>
      </div>

      {/* Setup: only when something is actually missing */}
      {(!ready || needsWallet) && (
        <div className="flex flex-col gap-3 border-b bg-muted/40 px-5 py-4 text-sm">
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
        <Collapsible className="border-b">
          <CollapsibleTrigger className="flex w-full items-center gap-2 px-5 py-3 text-left text-sm font-semibold hover:bg-muted/60">
            <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
            Tools <span className="text-muted-foreground">({status.tools.length})</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col gap-3 px-5 pb-4">
            {status.tools.map((t) => (
              <div key={t.name}>
                <p className="font-mono text-xs">
                  <span className="text-primary">&gt;</span> {t.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              </div>
            ))}
            <p className="border-t pt-3 text-xs text-muted-foreground">
              Add your own in <code className="rounded bg-muted px-1">agent/tools.ts</code>.
            </p>
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
              <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
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
                    "max-w-full rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm whitespace-pre-wrap",
                    m.error ? "bg-high-soft text-high" : "bg-muted"
                  )}
                >
                  {m.error && <CircleAlert className="mr-1 inline size-4" />}
                  {m.text}
                </div>
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
      <div className="border-t p-4">
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

/* ── One tool step: expandable, with the real Paid badge ── */
function ToolCall({ step }: { step: Step }) {
  const payment = step.result?.payment;
  return (
    <Collapsible className="w-full overflow-hidden rounded-xl border bg-card font-mono text-xs">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
        <ChevronRight className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
        <span className="text-muted-foreground uppercase">Tool</span>
        <span className="truncate text-primary">{step.tool}</span>
        {payment && <Badge className="ml-auto bg-blue font-mono text-white uppercase">Paid {payment.amount}</Badge>}
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
