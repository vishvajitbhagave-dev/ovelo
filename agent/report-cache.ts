/**
 * PAID REPORT CACHE
 *
 * A successful paid ticket-history report is kept in memory for a short time so
 * checking the same ticket twice does not pay twice. The cache lives at the
 * agent-tool layer (agent/tools.ts), which both the chat and the "Check this
 * ticket" button use.
 *
 * Only a paid, delivered report is cached. Failures, spend-limit refusals and
 * errors are never cached. A paid-but-unverified report may be cached, but its
 * original `verified: false` flag and `verifyReason` are preserved.
 *
 * The cache is per server instance. On serverless it resets on a cold start,
 * and different instances do not share it.
 */
import { REPORT_CACHE } from "./x402-config";
import type { OfficialPayResult } from "./x402";

type PaidPayment = NonNullable<OfficialPayResult["payment"]>;

export type CacheablePaidReport = {
  data: unknown;
  payment: PaidPayment;
};

export type CachedReportHit = CacheablePaidReport & {
  paidAt: number;
  ageSeconds: number;
};

/**
 * A report result. Reused results add the reuse fields; a fresh paid result
 * simply leaves them out.
 */
export type ReportResult = OfficialPayResult & {
  reused?: true;
  reusedFromTxHash?: string;
  blockNumber?: string;
  ageSeconds?: number;
};

export type ReusedReportResult = ReportResult & {
  reused: true;
  reusedFromTxHash: string;
  ageSeconds: number;
};

type Entry = CacheablePaidReport & { paidAt: number };

type ReportCacheOptions = {
  /** Clock. Defaults to Date.now. Tests pass a fake to control expiry. */
  now?: () => number;
  /** How long an entry stays fresh. Defaults to REPORT_CACHE.ttlMs. */
  ttlMs?: number;
  /** Maximum entries kept. Defaults to REPORT_CACHE.maxEntries. */
  maxEntries?: number;
};

/**
 * A report is safe to cache only when a payment settled, the response was a
 * successful HTTP response, and the report data actually contains a ticket.
 */
export function isCacheablePaidReport(result: OfficialPayResult): result is CacheablePaidReport {
  const payment = result.payment;
  const data = result.data as { ticket?: unknown } | null;
  return Boolean(
    payment &&
      typeof payment.txHash === "string" &&
      payment.txHash !== "" &&
      payment.settlement?.success === true &&
      payment.status >= 200 &&
      payment.status < 300 &&
      data &&
      typeof data === "object" &&
      data.ticket
  );
}

/** Build the honest reused-result shape from a cache hit. */
export function reusedReport(hit: CachedReportHit): ReusedReportResult {
  return {
    data: hit.data,
    payment: hit.payment,
    reused: true,
    reusedFromTxHash: hit.payment.txHash,
    blockNumber: hit.payment.blockNumber,
    ageSeconds: hit.ageSeconds,
  };
}

export class ReportCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<OfficialPayResult>>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: ReportCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? REPORT_CACHE.ttlMs;
    this.maxEntries = options.maxEntries ?? REPORT_CACHE.maxEntries;
  }

  /** A fresh cache hit, or null when missing/expired. Expired entries are removed. */
  get(ticketId: string): CachedReportHit | null {
    const entry = this.entries.get(ticketId);
    if (!entry) return null;

    const now = this.now();
    if (now - entry.paidAt >= this.ttlMs) {
      this.entries.delete(ticketId);
      return null;
    }

    return {
      data: entry.data,
      payment: entry.payment,
      paidAt: entry.paidAt,
      ageSeconds: Math.max(0, Math.floor((now - entry.paidAt) / 1000)),
    };
  }

  /** Store a successful paid report and evict the oldest entry past the cap. */
  set(ticketId: string, result: CacheablePaidReport): void {
    this.entries.delete(ticketId);
    this.entries.set(ticketId, { data: result.data, payment: result.payment, paidAt: this.now() });

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Test/diagnostic helper. */
  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  /** Number of cached entries (expired entries are pruned on read). */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Return a cached report, share an in-flight request for the same ticket, or
   * run the loader once. Only a cacheable paid report is stored. A failed load
   * rejects every waiter and is never cached.
   *
   * Cache hits must not count against visitor limits; the caller controls that
   * via `countOnHit`/by checking before calling load. The option exists so the
   * interface stays compatible and hits are never treated as paid.
   */
  async getOrLoad(
    ticketId: string,
    load: () => Promise<OfficialPayResult>,
    _opts: { countOnHit?: boolean } = {}
  ): Promise<ReportResult> {
    const hit = this.get(ticketId);
    if (hit) return reusedReport(hit);

    const pending = this.inFlight.get(ticketId);
    if (pending) {
      await pending;
      const shared = this.get(ticketId);
      return shared ? reusedReport(shared) : await pending;
    }

    const promise = (async () => {
      const result = await load();
      if (isCacheablePaidReport(result)) this.set(ticketId, result);
      return result;
    })();

    this.inFlight.set(ticketId, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(ticketId) === promise) this.inFlight.delete(ticketId);
    }
  }
}

/** The app-wide cache. Tests create their own ReportCache with a fake clock. */
export const reportCache = new ReportCache();
