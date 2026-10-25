import crypto from "node:crypto";

const CHAT_LIMIT_MESSAGE =
  "You have reached the chat limit for now. Please wait a few minutes and try again.";
const PAID_LIMIT_MESSAGE =
  "You have used your paid reports for now. Please try again in a few minutes.";

export type VisitorLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; message: string };

export type VisitorLimitsDeps = {
  now?: () => number;
};

type Bucket = {
  chatTimes: number[];
  paidTimes: number[];
  lastSeen: number;
};

const VISITOR_SALT = crypto.randomBytes(16).toString("hex");
const visitors = new Map<string, Bucket>();

/** Key used when no client IP can be determined (local/dev). */
export const LOCAL_VISITOR_ID = "local";

function getIpHash(ip: string | null): string {
  if (!ip) return LOCAL_VISITOR_ID;
  // One-way hash only; never store or log the raw IP.
  const h = crypto.createHash("sha256").update(VISITOR_SALT).update("|").update(ip).digest("hex");
  return `v_${h.slice(0, 32)}`;
}

function getClientIp(req: Request): string | null {
  // Vercel sets x-forwarded-for first value; x-real-ip as fallback.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = req.headers.get("x-real-ip");
  if (xri?.trim()) return xri.trim();
  return null;
}

/** Derive a non-reversible visitor id from the request. Safe for logging/keys only. */
export function getVisitorId(req: Request): string {
  return getIpHash(getClientIp(req));
}

/** Derive a visitor id from a raw IP (tests). */
export function getVisitorIdFromIp(ip: string | null | undefined): string {
  if (!ip) return LOCAL_VISITOR_ID;
  return getIpHash(ip);
}

function getBucket(key: string, now: number): Bucket {
  let b = visitors.get(key);
  if (!b) {
    b = { chatTimes: [], paidTimes: [], lastSeen: now };
    visitors.set(key, b);
  }
  b.lastSeen = now;
  return b;
}

function pruneBucket(b: Bucket, now: number, windowMs: number) {
  const cutoff = now - windowMs;
  while (b.chatTimes.length > 0 && b.chatTimes[0] <= cutoff) b.chatTimes.shift();
  while (b.paidTimes.length > 0 && b.paidTimes[0] <= cutoff) b.paidTimes.shift();
}

function evictIfNeeded(now: number) {
  if (visitors.size <= 1000) return;
  // Evict oldest by lastSeen
  let oldestKey: string | null = null;
  let oldestSeen = Infinity;
  for (const [k, v] of visitors) {
    if (v.lastSeen < oldestSeen) {
      oldestSeen = v.lastSeen;
      oldestKey = k;
    }
  }
  if (oldestKey) visitors.delete(oldestKey);
}

/** Check and (if allowed) reserve a chat request slot. Refused calls are not counted. */
export function checkAndRecordChat(
  visitorId: string,
  limits: { chatPer10m: number; windowMs: number; maxVisitors: number },
  deps: VisitorLimitsDeps = {}
): VisitorLimitResult {
  const now = (deps.now ?? Date.now)();
  const b = getBucket(visitorId, now);
  pruneBucket(b, now, limits.windowMs);
  if (b.chatTimes.length >= limits.chatPer10m) {
    const oldest = b.chatTimes[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + limits.windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds, message: CHAT_LIMIT_MESSAGE };
  }
  b.chatTimes.push(now);
  b.lastSeen = now;
  evictIfNeeded(now);
  return { allowed: true };
}

/** Check and (if allowed) reserve a paid call slot. Refused calls are not counted. */
export function checkAndRecordPaid(
  visitorId: string,
  limits: { paidPer10m: number; windowMs: number; maxVisitors: number },
  deps: VisitorLimitsDeps = {}
): VisitorLimitResult {
  // Experiment runner (and some local test paths) use ctx without visitorId;
  // treat as fixed "runner" bucket and do not count against limits.
  if (visitorId === "runner") return { allowed: true };
  const now = (deps.now ?? Date.now)();
  const b = getBucket(visitorId, now);
  pruneBucket(b, now, limits.windowMs);
  if (b.paidTimes.length >= limits.paidPer10m) {
    const oldest = b.paidTimes[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + limits.windowMs - now) / 1000));
    return { allowed: false, retryAfterSeconds, message: PAID_LIMIT_MESSAGE };
  }
  b.paidTimes.push(now);
  b.lastSeen = now;
  evictIfNeeded(now);
  return { allowed: true };
}

/** For tests: clear all state. */
export function resetVisitorLimits(): void {
  visitors.clear();
}

/** For tests: count tracked visitors. */
export function trackedVisitorCount(): number {
  return visitors.size;
}
