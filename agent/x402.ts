/**
 * THE x402 PAYER (the agent's side of a paid API call)
 *
 * This is the official SDK path, used by the paid tools in agent/tools.ts.
 * agent/x402-server.ts holds the other side (the APIs that charge).
 *
 *   1. GET the URL with wrapFetchWithPayment (@x402/fetch).
 *   2. On a 402, the wrapper reads the standard PAYMENT-REQUIRED header,
 *      signs an EIP-3009 authorization with the agent's viem account
 *      (ExactEvmScheme, @x402/evm), and retries with PAYMENT-SIGNATURE.
 *   3. The resource server settles through the facilitator; the settlement
 *      result (including the on-chain transaction hash) comes back in the
 *      PAYMENT-RESPONSE header, decoded via x402HTTPClient.processResponse.
 *   4. agent/x402-verify.ts then reads that transaction back from Base Sepolia
 *      with viem and checks the USDC Transfer log itself. The facilitator's
 *      word alone is never enough to say "settled on-chain".
 *
 * SETTLE FAILURES ARE RETRIED ONCE, SAFELY. The shared testnet facilitator
 * occasionally returns a transient `settle_failed` (e.g.
 * invalid_exact_evm_transaction_failed) even though verification passed. When
 * that happens we do NOT give up immediately: we first CHECK THE CHAIN for a
 * Transfer that may already have gone through, and only if nothing moved do we
 * retry the whole call once. Each attempt signs a FRESH EIP-3009 authorization
 * (new random nonce, new validBefore), so a retry can never replay or double
 * pay: the two authorizations are distinct and only one can settle. This is
 * capped at TWO attempts and only ever on `settle_failed` — never on
 * payment_required, a missing wallet, a 404 or a transport error.
 *
 * A non-settled outcome throws: a failed purchase is never a success.
 * An unverified outcome does NOT throw — the money may have moved, so the
 * report data is kept and the payment is flagged with `verified: false` and a
 * `verifyReason` instead of being presented as settled.
 *
 * A SPEND GUARD runs first (agent/x402-limits.ts): at most 10 paid calls a
 * rolling hour, at most 3 a rolling minute, and at least 0.5 test USDC in the
 * agent wallet. A refused call throws the honest "Paid call limit reached, try
 * again later" and signs nothing. The time limits are in-memory/per-instance on
 * serverless; the balance floor is a live chain read and always holds.
 *
 * Importing this module pays for nothing; the wallet is only read when
 * payAndFetchOfficial() runs.
 */
import fs from "fs";
import path from "path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { X402 } from "./x402-config";
import { BASESCAN } from "./escrow-config";
import {
  verifyX402Settlement,
  findRecentTransfer,
  type SettlementTransfer,
} from "./x402-verify";
import {
  checkX402SpendLimit,
  type CheckX402SpendLimitOptions,
  type X402SpendLimitResult,
} from "./x402-limits";

/** Same key source as agent/wallet.ts: env var first, then the wallet file. */
const WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");

function loadAccount() {
  const key =
    process.env.WALLET_PRIVATE_KEY ||
    (fs.existsSync(WALLET_FILE) && JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")).privateKey);
  return key ? privateKeyToAccount(key as Hex) : null;
}

/** The settlement facts carried by the PAYMENT-RESPONSE header. */
export type OfficialSettlement = {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
};

/**
 * Format atomic USDC units as the same "0.01 USDC" label the UI and the
 * activity log show (see lib/activity.ts). Falls back to the advertised
 * price when the settled amount is missing or unparseable.
 * Pure — no chain or network access.
 */
export function formatUsdcLabel(atomic: string | null | undefined, fallbackPrice: string, decimals = 6): string {
  if (atomic === null || atomic === undefined || atomic === "") return `${fallbackPrice} USDC`;
  let value: bigint;
  try {
    value = BigInt(atomic);
  } catch {
    return `${fallbackPrice} USDC`;
  }
  if (value < 0n) return `${fallbackPrice} USDC`;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${frac ? `${whole}.${frac}` : whole.toString()} USDC`;
}

/**
 * Normalize a decoded PAYMENT-RESPONSE header into the settlement facts,
 * or null when there is no usable transaction hash. Pure — no chain access.
 */
export function extractSettlement(
  header:
    | {
        success?: boolean;
        transaction?: string;
        network?: string;
        payer?: string;
      }
    | null
    | undefined
): OfficialSettlement | null {
  if (!header || typeof header.transaction !== "string" || header.transaction === "") return null;
  const settlement: OfficialSettlement = {
    success: header.success === true,
    transaction: header.transaction,
    network: typeof header.network === "string" ? header.network : "",
  };
  if (typeof header.payer === "string") settlement.payer = header.payer;
  return settlement;
}

/** What payAndFetchOfficial resolves to. `payment` is absent when nothing was paid. */
export type OfficialPayResult = {
  data: unknown;
  payment?: {
    /** HTTP status of the paid response, same field the legacy flow returns. */
    status: number;
    /** Same "0.01 USDC" label the legacy flow returns. */
    amount: string;
    to: string;
    /** Settlement facts from the PAYMENT-RESPONSE header (the facilitator's claim). */
    settlement: OfficialSettlement;
    /** Convenience copy of settlement.transaction; null only never — settlement is required. */
    txHash: string;
    /** Basescan link for that transaction (the settlement is on Base Sepolia). */
    url: string;
    /**
     * TRUE only after OUR code read the receipt back from Base Sepolia and found
     * the USDC Transfer (agent wallet -> payTo, exact price). False means the
     * facilitator reported success but we could not confirm it ourselves.
     */
    verified: boolean;
    /** Why it could not be confirmed. Set only when `verified` is false. */
    verifyReason?: string;
    /** The block the settlement landed in. Set only when `verified` is true. */
    blockNumber?: string;
  };
};

/**
 * Injectable seams so the retry/guard logic can be unit-tested with no network,
 * no wallet file and no real payment. Every field defaults to the real thing.
 */
export type PayDeps = {
  /** The payer account. Defaults to the wallet file / WALLET_PRIVATE_KEY. */
  account?: { address: string; signTypedData: (args: any) => Promise<string> } | null;
  /** The fetch used by the payment wrapper. Defaults to global fetch. */
  fetch?: typeof fetch;
  /** The guard's chain scan. Defaults to findRecentTransfer against Base Sepolia. */
  findTransfer?: typeof findRecentTransfer;
  /** Our own receipt check. Defaults to verifyX402Settlement. */
  verify?: typeof verifyX402Settlement;
  /**
   * The spend guard, run BEFORE any signing. Defaults to checkX402SpendLimit.
   * Tests pass a fake so the limits can be exercised with no chain read.
   */
  checkLimit?: (options: CheckX402SpendLimitOptions) => Promise<X402SpendLimitResult>;
};

type SettleHeader = {
  success?: boolean;
  errorReason?: string;
  errorMessage?: string;
  transaction?: string;
  network?: string;
  payer?: string;
  amount?: string;
};

/** One paid attempt: the parsed response plus whether the server asked to pay. */
type Attempt = {
  paymentStatus: "settled" | "settle_failed" | "payment_required" | "none";
  status: number;
  body: unknown;
  header: SettleHeader | undefined;
};

/**
 * Run ONE full paid call: GET the URL, let the wrapper answer a 402 with a
 * freshly signed authorization, and parse the outcome. Does not retry and does
 * not throw for a settle failure — the caller decides what to do with it.
 */
async function attemptPayment(url: string, deps: PayDeps): Promise<Attempt> {
  const account = deps.account === undefined ? loadAccount() : deps.account;
  if (!account) {
    throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  }

  const client = new x402Client().register("eip155:*", new ExactEvmScheme(account as any));
  const fetchWithPayment = wrapFetchWithPayment(deps.fetch ?? fetch, client);
  const httpClient = new x402HTTPClient(client);

  const response = await fetchWithPayment(url);
  const result = await httpClient.processResponse(response);
  return {
    paymentStatus: result.paymentStatus,
    status: result.status,
    body: result.body,
    header: result.header as SettleHeader | undefined,
  };
}

/** Build the final result once an attempt has settled: verify it ourselves. */
async function verifyAndReturn(
  attempt: Attempt,
  settlement: OfficialSettlement,
  verify: typeof verifyX402Settlement,
  payer: string
): Promise<OfficialPayResult> {
  const verification = await verify(settlement.transaction, { payer });
  return {
    data: attempt.body,
    payment: {
      status: attempt.status,
      amount: formatUsdcLabel(attempt.header?.amount, X402.priceUsd),
      to: X402.payTo,
      settlement,
      txHash: settlement.transaction,
      url: BASESCAN.tx(settlement.transaction),
      verified: verification.verified,
      verifyReason: verification.verified ? undefined : verification.reason,
      blockNumber: verification.verified ? verification.blockNumber : undefined,
    },
  };
}

/** The honest error for a settle failure that we did not retry (or retried). */
function settleFailureError(attempt: Attempt, triedTwice: boolean): Error {
  const detail = attempt.header?.errorReason ?? attempt.header?.errorMessage;
  const base = `The x402 payment was not settled (${attempt.paymentStatus}${detail ? `: ${detail}` : ""}).`;
  return new Error(triedTwice ? `${base} Tried twice; the second attempt failed too.` : base);
}

/**
 * Fetch a URL, paying an x402 price with the agent's wallet through the
 * official SDK and the testnet facilitator. Returns the body plus the payment
 * (amount, payee, tx hash, Basescan link) and our own on-chain confirmation of
 * that transaction (`verified` / `verifyReason` / `blockNumber`).
 *
 * A `settle_failed` outcome is retried EXACTLY ONCE, and only after a read-only
 * chain guard confirms no Transfer actually went through (see findRecentTransfer).
 * Each attempt signs a fresh authorization, so this can never double pay.
 *
 * Throws on: no wallet, a spend-limit refusal, transport errors, and any outcome
 * that is not a settled payment. `payment_required`, `none` handled as before; a
 * twice-failed settle throws the same honest error, saying it was tried twice.
 * It never throws because verification failed — see verifyX402Settlement.
 */
export async function payAndFetchOfficial(url: string, deps: PayDeps = {}): Promise<OfficialPayResult> {
  const account = deps.account === undefined ? loadAccount() : deps.account;
  if (!account) {
    throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  }
  const payer = account.address;
  const verify = deps.verify ?? verifyX402Settlement;
  const findTransfer = deps.findTransfer ?? findRecentTransfer;
  const checkLimit = deps.checkLimit ?? checkX402SpendLimit;

  // SPEND GUARD, before anything is signed. Refuses (throws, moves no money) when
  // the rolling-call limits are hit or the wallet is below the USDC floor. An
  // allowed call is counted here, so a burst cannot slip past the minute cap.
  const limit = await checkLimit({ payer });
  if (!limit.allowed) {
    throw new Error(limit.message);
  }

  // Attempt 1 — the guard below bounds itself to the last few minutes of chain,
  // so it can only ever see a Transfer from around this attempt, never an old one.
  const first = await attemptPayment(url, { ...deps, account });

  if (first.paymentStatus === "none") {
    return { data: first.body };
  }

  if (first.paymentStatus === "settled") {
    const settlement = extractSettlement(first.header);
    if (!settlement || !settlement.success) {
      throw new Error(
        "The x402 payment reported settled but carried no successful transaction. Not treating it as paid."
      );
    }
    return verifyAndReturn(first, settlement, verify, payer);
  }

  // Only a settle failure is retried. Anything else (payment_required) keeps the
  // old honest behaviour: throw immediately, no retry.
  if (first.paymentStatus !== "settle_failed") {
    throw settleFailureError(first, false);
  }

  // DOUBLE-PAY GUARD: the facilitator reported a failure, but it may still have
  // mined the transfer. Scan the chain before spending a second time.
  const existing = await findTransfer({ payer }).catch(() => null);

  if (existing) {
    // The money already moved. Do NOT retry. Treat it as paid-but-unverified:
    // keep any data we have and never claim it was settled on-chain.
    return {
      data: first.body,
      payment: {
        status: first.status,
        amount: formatUsdcLabel(first.header?.amount, X402.priceUsd),
        to: X402.payTo,
        settlement: {
          success: true,
          transaction: existing.transactionHash,
          network: X402.network,
        },
        txHash: existing.transactionHash,
        url: BASESCAN.tx(existing.transactionHash),
        verified: false,
        verifyReason:
          `the first attempt reported a settle failure, but a matching USDC Transfer already exists ` +
          `on chain (block ${existing.blockNumber}); not retrying, so this is paid but not confirmed by us.`,
      },
    };
  }

  // No transfer found: safe to retry ONCE with a brand-new signature.
  const second = await attemptPayment(url, { ...deps, account });

  if (second.paymentStatus === "none") {
    return { data: second.body };
  }
  if (second.paymentStatus !== "settled") {
    throw settleFailureError(second, true);
  }

  const settlement = extractSettlement(second.header);
  if (!settlement || !settlement.success) {
    throw new Error(
      "The x402 payment reported settled on the retry but carried no successful transaction. Not treating it as paid."
    );
  }
  return verifyAndReturn(second, settlement, verify, payer);
}
