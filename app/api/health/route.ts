import { getEscrowStatus, readDeal } from "@/agent/escrow";
import { ALLOWED_MODELS } from "@/agent/models";
import { X402 } from "@/agent/x402-config";
import { buildHealthReport, type HealthReport } from "@/lib/health";

export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30_000;
const READ_TIMEOUT_MS = 5_000;

let cache: { expiresAt: number; value: HealthReport } | null = null;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function checkFacilitatorReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const url = `${X402.facilitatorUrl.replace(/\/$/, "")}/supported`;
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function countOpenDeals(agentAddress: string, totalDeals: number): Promise<number> {
  const deals = await Promise.all(
    Array.from({ length: totalDeals }, (_, index) => readDeal(BigInt(index + 1)).catch(() => null))
  );
  return deals.filter((deal) => deal?.status === "Funded" && deal.buyer.toLowerCase() === agentAddress.toLowerCase()).length;
}

async function collectHealthReport(): Promise<HealthReport> {
  const readFailures: string[] = [];
  const [escrowResult, facilitatorReachable] = await Promise.all([
    withTimeout(getEscrowStatus(), READ_TIMEOUT_MS).catch(() => {
      readFailures.push("escrow_status_read_failed");
      return null;
    }),
    checkFacilitatorReachable(),
  ]);

  if (!facilitatorReachable) readFailures.push("facilitator_unreachable");

  let openDeals = 0;
  if (escrowResult?.configured && escrowResult.address) {
    try {
      openDeals = await withTimeout(
        countOpenDeals(escrowResult.address, escrowResult.dealCount),
        READ_TIMEOUT_MS
      );
    } catch {
      readFailures.push("open_deals_read_failed");
    }
  }

  return buildHealthReport({
    now: new Date(),
    commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
    escrowStatus: escrowResult,
    openDeals,
    facilitatorReachable,
    models: ALLOWED_MODELS.map((model) => model.id),
    geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    agentWalletConfigured: Boolean(escrowResult?.configured),
    readFailures,
  });
}

function json(report: HealthReport): Response {
  return Response.json(report, {
    status: 200,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET() {
  if (cache && cache.expiresAt > Date.now()) {
    return json(cache.value);
  }

  try {
    const report = await collectHealthReport();
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, value: report };
    return json(report);
  } catch {
    const fallback = buildHealthReport({
      now: new Date(),
      commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
      escrowStatus: null,
      openDeals: 0,
      facilitatorReachable: false,
      models: ALLOWED_MODELS.map((model) => model.id),
      geminiKeyConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      agentWalletConfigured: false,
      readFailures: ["health_check_failed"],
    });
    cache = { expiresAt: Date.now() + CACHE_TTL_MS, value: fallback };
    return json(fallback);
  }
}
