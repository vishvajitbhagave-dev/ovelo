/**
 * x402 SPEND GUARD — the agent's own safety limits on paid calls.
 *
 * payAndFetchOfficial() runs this BEFORE it signs anything, so a refused call
 * moves no money. It enforces three limits, all sized for the throwaway testnet
 * wallet (see the constants in agent/x402-config.ts):
 *
 *   1. at most X402.maxPaidCallsPerHour paid calls in any rolling hour,
 *   2. at most X402.maxPaidCallsPerMinute paid calls in any rolling minute,
 *   3. the agent wallet must hold at least X402.minAgentUsdcBaseUnits test USDC
 *      (a read-only balanceOf; nothing is signed or sent to check it).
 *
 * HONESTY ABOUT THE COUNTERS. The two time limits are counted in an in-memory
 * array of timestamps held by this module. That means:
 *
 *   - It is PER SERVER INSTANCE. On a host like Vercel each serverless instance
 *     (and each cold start) has its own empty counters, so the real-world ceiling
 *     can be higher than 10/hour if requests spread across instances, and can
 *     reset to zero at any moment. It is a railing, not a lock.
 *   - It does not survive a restart. There is no database and no shared cache.
 *
 * The floor on the wallet balance is the one limit that is NOT affected by any
 * of this: it is read from the chain on every call, so it holds everywhere. With
 * a 0.01 USDC price and a 0.5 USDC floor the wallet can afford at most 50 calls
 * before the floor stops it — a global, per-instance-independent backstop.
 *
 * A durable fix without adding a service would need a shared store (Vercel KV /
 * Upstash Redis, or the chain itself, e.g. counting recent USDC Transfers). That
 * is deliberately out of scope here; this module is the small, honest version.
 *
 * Server-only. Importing it costs nothing; the chain is read only when
 * checkX402SpendLimit() runs.
 */
import { createPublicClient, http, erc20Abi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { X402 } from "./x402-config";
import { ESCROW } from "./escrow-config";

// Belt-and-braces: this module must never run in a browser bundle.
if (typeof window !== "undefined") {
  throw new Error("agent/x402-limits.ts is server-only and must not be imported by client code.");
}

/** Same public RPC the escrow/verify modules use (overridable with BASE_SEPOLIA_RPC_URL). */
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl) });

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Every ALLOWED paid call's start time (ms), oldest first. A refused call is
 * never recorded, so being blocked does not itself consume budget. In-memory and
 * per instance — see the honesty note above.
 */
const paidCallTimes: number[] = [];

/** The limit that was hit, for a caller that wants to branch on it. */
export type X402LimitCode = "MINUTE" | "HOUR" | "LOW_BALANCE";

/** The verdict. `allowed: true` carries nothing else; a refusal explains itself. */
export type X402SpendLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      code: X402LimitCode;
      /** The honest, user-facing sentence. One clear reason, no jargon. */
      message: string;
      /** For the time limits: roughly how long until a slot frees up. */
      retryAfterSeconds?: number;
    };

export type CheckX402SpendLimitOptions = {
  /** The agent wallet address; only used for the balance read. */
  payer: string;
  /** Clock. Defaults to Date.now. Tests pass a fake to control the windows. */
  now?: () => number;
  /** Balance source, in base units. Tests pass a fake so no RPC is contacted. */
  getUsdcBalance?: (address: string) => Promise<bigint>;
};

/** The honest sentence returned whenever a paid call is refused. */
export const X402_LIMIT_MESSAGE = "Paid call limit reached, try again later.";

/** Drop timestamps that have fallen out of the rolling hour. Mutates in place. */
function prune(times: number[], now: number): void {
  const cutoff = now - HOUR_MS;
  while (times.length > 0 && times[0] <= cutoff) times.shift();
}

/** How many of the recorded calls are within the last `windowMs`. */
function countWithin(times: number[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let count = 0;
  for (let i = times.length - 1; i >= 0; i--) {
    if (times[i] > cutoff) count += 1;
    else break;
  }
  return count;
}

/**
 * The recorded call times, oldest first. Exposed for tests and diagnostics only;
 * the array is the module's live state, so treat it as read-only.
 */
export function recordedPaidCalls(): readonly number[] {
  return paidCallTimes;
}

/** Forget all recorded calls. Tests use this between cases; the app never does. */
export function resetX402SpendLimits(): void {
  paidCallTimes.length = 0;
}

async function readUsdcBalance(address: string): Promise<bigint> {
  return (await publicClient.readContract({
    address: X402.token as Address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as Address],
  })) as bigint;
}

/**
 * Check whether one more paid call is allowed, and if so RESERVE its slot.
 *
 * Order matters: the cheap in-memory time checks run first, then the chain
 * balance read. On `allowed: true` the call time is recorded immediately, so a
 * burst of concurrent calls each count even before any of them settles.
 *
 * A failure to READ the balance is treated as "cannot confirm the floor is met"
 * only when the read throws: we refuse, because spending blind is the risk we
 * are guarding against. (The price floor is a safety net, not a convenience.)
 */
export async function checkX402SpendLimit(
  options: CheckX402SpendLimitOptions
): Promise<X402SpendLimitResult> {
  const now = (options.now ?? Date.now)();
  prune(paidCallTimes, now);

  const minuteCount = countWithin(paidCallTimes, now, MINUTE_MS);
  if (minuteCount >= X402.maxPaidCallsPerMinute) {
    const oldest = paidCallTimes[paidCallTimes.length - minuteCount];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1000));
    return {
      allowed: false,
      code: "MINUTE",
      message: `${X402_LIMIT_MESSAGE} (at most ${X402.maxPaidCallsPerMinute} paid calls a minute)`,
      retryAfterSeconds,
    };
  }

  const hourCount = countWithin(paidCallTimes, now, HOUR_MS);
  if (hourCount >= X402.maxPaidCallsPerHour) {
    const oldest = paidCallTimes[paidCallTimes.length - hourCount];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + HOUR_MS - now) / 1000));
    return {
      allowed: false,
      code: "HOUR",
      message: `${X402_LIMIT_MESSAGE} (at most ${X402.maxPaidCallsPerHour} paid calls an hour)`,
      retryAfterSeconds,
    };
  }

  const getBalance = options.getUsdcBalance ?? readUsdcBalance;
  const floor = BigInt(X402.minAgentUsdcBaseUnits);
  let balance: bigint;
  try {
    balance = await getBalance(options.payer);
  } catch {
    return {
      allowed: false,
      code: "LOW_BALANCE",
      message: `${X402_LIMIT_MESSAGE} The agent wallet's balance could not be read to confirm the safety floor.`,
    };
  }
  if (balance < floor) {
    return {
      allowed: false,
      code: "LOW_BALANCE",
      message:
        `${X402_LIMIT_MESSAGE} The agent wallet holds too little test USDC ` +
        `(needs at least ${formatUsdcFloor(floor)}).`,
    };
  }

  paidCallTimes.push(now);
  return { allowed: true };
}

/** "0.5 USDC" from base units, for the refusal message. Pure. */
export function formatUsdcFloor(baseUnits: bigint, decimals = X402.tokenDecimals): string {
  const whole = baseUnits / 10n ** BigInt(decimals);
  const frac = (baseUnits % 10n ** BigInt(decimals))
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${frac ? `${whole}.${frac}` : whole.toString()} USDC`;
}
