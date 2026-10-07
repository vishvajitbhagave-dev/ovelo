/**
 * THE RISK CARD
 *
 * Renders the result of the `check_ticket_risk` tool straight from the data
 * the tool returned — never from the AI's prose. The score, level, reasons
 * and recommendation the user sees are exactly what the fixed rules in
 * agent/tickets.ts produced.
 *
 * Everything here fails safe: if the payload is missing, incomplete, the
 * wrong type, or a "not found" reply, the card renders nothing at all
 * instead of guessing or throwing.
 */
import { Badge } from "./ui/badge";
import { cn } from "cn";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type RiskData = {
  ticketId: string;
  riskLevel: RiskLevel;
  score: number;
  reasons: string[];
  recommendation: string;
};

/**
 * Validate a `check_ticket_risk` result and pull out only what the card
 * shows. Returns null for anything it cannot fully trust.
 */
export function parseRiskResult(result: unknown): RiskData | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) return null;

  const r = result as Record<string, unknown>;

  // The tool's "not found" reply — never show a card for this.
  if (r.found === false) return null;

  if (typeof r.ticketId !== "string" || r.ticketId.trim() === "") return null;

  const level = r.riskLevel;
  if (level !== "LOW" && level !== "MEDIUM" && level !== "HIGH") return null;

  if (typeof r.score !== "number" || !Number.isFinite(r.score)) return null;

  if (!Array.isArray(r.reasons) || r.reasons.length === 0) return null;
  if (!r.reasons.every((reason) => typeof reason === "string" && reason.trim() !== "")) return null;

  const recommendation = r.recommendation;
  if (typeof recommendation !== "string" || recommendation.trim() === "") return null;

  return {
    ticketId: r.ticketId,
    riskLevel: level,
    score: r.score,
    reasons: r.reasons as string[],
    recommendation,
  };
}

/** LOW = green, MEDIUM = amber, HIGH = red, using the theme's risk tokens. */
const LEVEL_STYLE: Record<RiskLevel, { badge: string; edge: string; label: string; dot: string }> = {
  LOW: { badge: "bg-low-soft text-low", edge: "border-l-low", label: "text-low", dot: "bg-low" },
  MEDIUM: { badge: "bg-medium-soft text-medium", edge: "border-l-medium", label: "text-medium", dot: "bg-medium" },
  HIGH: { badge: "bg-high-soft text-high", edge: "border-l-high", label: "text-high", dot: "bg-high" },
};

export function RiskCard({ result }: { result: unknown }) {
  const data = parseRiskResult(result);
  if (!data) return null;

  const style = LEVEL_STYLE[data.riskLevel];

  return (
    <div
      className={cn(
        "w-full min-w-0 overflow-hidden rounded-2xl border border-l-2 bg-card shadow-[var(--shadow-card)]",
        style.edge
      )}
    >
      {/* Ticket id, level badge, score */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-muted/40 px-3 py-2">
        <span className="font-mono text-sm font-bold break-words">{data.ticketId}</span>
        <Badge className={cn("font-mono font-bold uppercase", style.badge)}>{data.riskLevel}</Badge>
        <span className="ml-auto font-mono text-xs whitespace-nowrap text-muted-foreground">Score {data.score}</span>
      </div>

      {/* Why — straight from the rules */}
      <div className="flex flex-col gap-2 px-3 py-3">
        <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Why</p>
        <ul className="flex flex-col gap-1.5">
          {data.reasons.map((reason, i) => (
            <li key={i} className="flex gap-2 text-sm leading-snug">
              <span className={cn("mt-1.5 size-1.5 shrink-0", style.dot)} aria-hidden="true" />
              <span className="min-w-0 break-words">{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Recommendation */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-3 py-2.5">
        <span className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Recommendation</span>
        <span className={cn("min-w-0 font-mono text-sm font-bold break-words uppercase", style.label)}>
          {data.recommendation}
        </span>
      </div>

      {/* Honest footer */}
      <div className="border-t px-3 py-2 text-[11px] leading-snug text-muted-foreground">
        Result decided by fixed rules in code, not by the AI. Demo tickets only.
      </div>
    </div>
  );
}
