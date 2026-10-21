/**
 * x402 SETTLEMENT VERIFIER — OUR OWN on-chain check of a paid API call.
 *
 * The facilitator's PAYMENT-RESPONSE header is a claim made by a third party,
 * not evidence. Before the UI is allowed to say "settled on-chain", our code
 * reads the transaction receipt back from Base Sepolia with viem and checks the
 * USDC Transfer log itself:
 *
 *   1. the receipt status is "success",
 *   2. the USDC token (X402.token) emitted a standard ERC-20 Transfer event,
 *   3. that log's `from` is the agent wallet, `to` is X402.payTo, and `value` is
 *      exactly X402.priceBaseUnits (10000 base units = 0.01 USDC).
 *
 * Nothing here throws for "not verified": a payment that really moved money but
 * could not be confirmed must be reported as PAID BUT UNVERIFIED — never as a
 * failure, and never as a free result.
 *
 * RPC LAG (the agent/escrow.ts lesson): the public Base Sepolia RPC is
 * load-balanced, so right after the settlement is mined a node can still answer
 * "receipt not found". We therefore poll the receipt for up to ~20 seconds
 * before giving up, and only then report it as unverified.
 *
 * Server-only. Importing this module opens no connection and pays for nothing;
 * the RPC is used only when verifyX402Settlement() runs.
 */
import { createPublicClient, http, toEventSelector, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { X402 } from "./x402-config";
import { ESCROW } from "./escrow-config";

// Belt-and-braces: this module must never run in a browser bundle.
if (typeof window !== "undefined") {
  throw new Error("agent/x402-verify.ts is server-only and must not be imported by client code.");
}

/** Topic 0 of every ERC-20 Transfer log. */
const TRANSFER_EVENT = toEventSelector(
  "event Transfer(address indexed from, address indexed to, uint256 value)"
);

const TOKEN = X402.token;
const PAY_TO = X402.payTo;
const EXPECTED_VALUE = BigInt(X402.priceBaseUnits);

/** Same public RPC the escrow module uses (overridable with BASE_SEPOLIA_RPC_URL). */
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl) });

/** 9 sleeps x 2s + RPC time ≈ 20 seconds, the window the escrow module waits. */
const DEFAULT_ATTEMPTS = 10;
const DEFAULT_WAIT_MS = 2000;

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// ───────────────────────────── receipt shapes ─────────────────────────────

/** Just enough of a viem log to check a settlement. */
export type SettlementReceiptLog = {
  address: string;
  topics: readonly string[];
  data: string;
};

/** Just enough of a viem `getTransactionReceipt` result to check a settlement. */
export type SettlementReceipt = {
  status: string;
  blockNumber: bigint | number | string;
  logs: readonly SettlementReceiptLog[];
};

/**
 * The answer. Both shapes are plain JSON (strings only) because this travels
 * through the agent tool result into the browser — BigInt would not serialize.
 */
export type SettlementVerification =
  | {
      verified: true;
      /** Block the settlement was mined in. */
      blockNumber: string;
      /** Transfer sender read from the log (the agent wallet). */
      from: string;
      /** Transfer recipient read from the log (X402.payTo). */
      to: string;
      /** Transfer value in base units, as a decimal string. */
      value: string;
    }
  | {
      verified: false;
      /** Plain words explaining why we could not confirm it. Never a throw. */
      reason: string;
    };

// ───────────────────────────── address helpers ─────────────────────────────

/**
 * Lower-case an address or a 32-byte padded topic down to its 40 hex digits so
 * a checksummed address and a lowercase topic compare equal. Returns "" for
 * anything that is not hex, so garbage never compares equal to garbage.
 */
function addressKey(value: string): string {
  const hex = String(value ?? "")
    .toLowerCase()
    .replace(/^0x/, "");
  if (!/^[0-9a-f]*$/.test(hex)) return "";
  return hex.padStart(40, "0").slice(-40);
}

function sameAddress(a: string, b: string): boolean {
  const left = addressKey(a);
  const right = addressKey(b);
  return left !== "" && left === right;
}

function blockLabel(blockNumber: SettlementReceipt["blockNumber"]): string {
  try {
    return String(BigInt(blockNumber));
  } catch {
    return String(blockNumber);
  }
}

// ───────────────────────────── pure verification ─────────────────────────────

/**
 * Check a receipt against the expected settlement. Pure: no network, no clock,
 * no randomness — this is what the unit tests exercise with fake receipts.
 *
 * `payer` is the agent wallet address that must appear as the Transfer sender.
 * Never throws: every failure path returns `{ verified: false, reason }`.
 */
export function verifyX402Receipt(
  receipt: SettlementReceipt | null | undefined,
  payer: string
): SettlementVerification {
  try {
    return checkReceipt(receipt, payer);
  } catch (err) {
    // Defensive: a malformed receipt object must still produce an answer.
    return {
      verified: false,
      reason: `the receipt could not be checked: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function checkReceipt(
  receipt: SettlementReceipt | null | undefined,
  payer: string
): SettlementVerification {
  if (!receipt || typeof receipt !== "object") {
    return { verified: false, reason: "no transaction receipt was read from the chain." };
  }

  const block = blockLabel(receipt.blockNumber);

  if (receipt.status !== "success") {
    return {
      verified: false,
      reason: `the transaction status is "${String(receipt.status)}", not "success" (block ${block}).`,
    };
  }

  if (!payer || addressKey(payer) === "") {
    return { verified: false, reason: "no agent wallet address was supplied to check the Transfer sender." };
  }

  const logs: readonly SettlementReceiptLog[] = Array.isArray(receipt.logs) ? receipt.logs : [];

  const fromToken = logs.filter((log) => sameAddress(log?.address ?? "", TOKEN));
  const transfers = fromToken.filter((log) => String(log?.topics?.[0] ?? "").toLowerCase() === TRANSFER_EVENT);

  if (transfers.length === 0) {
    return fromToken.length > 0
      ? {
          verified: false,
          reason: `the ${X402.tokenName} contract (${TOKEN}) emitted no Transfer event in this receipt (block ${block}).`,
        }
      : {
          verified: false,
          reason: `the receipt has no log from the ${X402.tokenName} token ${TOKEN} (block ${block}).`,
        };
  }

  const log = transfers[0];
  const topics = Array.isArray(log.topics) ? log.topics : [];

  if (topics.length !== 3) {
    return {
      verified: false,
      reason: `the Transfer log in block ${block} is malformed (expected 3 topics, found ${topics.length}).`,
    };
  }

  let value: bigint;
  try {
    value = BigInt(log.data);
  } catch {
    return { verified: false, reason: `the Transfer log in block ${block} has an unreadable value.` };
  }

  const from = String(topics[1]);
  const to = String(topics[2]);

  if (!sameAddress(from, payer)) {
    return {
      verified: false,
      reason: `the Transfer sender is ${from}, expected the agent wallet ${payer} (block ${block}).`,
    };
  }

  if (!sameAddress(to, PAY_TO)) {
    return {
      verified: false,
      reason: `the Transfer recipient is ${to}, expected the payTo address ${PAY_TO} (block ${block}).`,
    };
  }

  if (value !== EXPECTED_VALUE) {
    return {
      verified: false,
      reason: `the Transfer amount is ${value} base units, expected exactly ${EXPECTED_VALUE} (${X402.priceUsd} USDC), in block ${block}.`,
    };
  }

  return {
    verified: true,
    blockNumber: block,
    from,
    to,
    value: value.toString(),
  };
}

// ───────────────────────────── chain read ─────────────────────────────

export type VerifyX402SettlementOptions = {
  /** The agent wallet address that must appear as the Transfer sender. */
  payer: string;
  /** How many times to try to read the receipt. Default 10. */
  attempts?: number;
  /** Delay between attempts, in ms. Default 2000 (≈ 20s in total). */
  waitMs?: number;
  /** Receipt source. Tests pass a fake so no RPC is ever contacted. */
  getReceipt?: (hash: string) => Promise<SettlementReceipt | null>;
};

function describeError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split("\n")[0].slice(0, 200);
}

async function readReceiptFromChain(hash: string): Promise<SettlementReceipt | null> {
  // A lagging node answers "not found" by throwing; treat that as "not yet".
  // Anything else (transport failure) is also retried by the polling loop.
  try {
    return (await publicClient.getTransactionReceipt({ hash: hash as Hex })) as SettlementReceipt;
  } catch {
    return null;
  }
}

/**
 * Read the settlement transaction back from Base Sepolia and check it against
 * the expected USDC Transfer.
 *
 * Polls for up to ~20 seconds because the public RPC lags right after a write;
 * once a receipt is readable it is judged immediately (a mined receipt never
 * changes). Never throws: an RPC problem, an unknown hash or a mismatch all come
 * back as `{ verified: false, reason }` so the caller can keep the paid data and
 * say plainly that Ovelo could not confirm the payment itself.
 */
export async function verifyX402Settlement(
  hash: string,
  options: VerifyX402SettlementOptions
): Promise<SettlementVerification> {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const waitMs = Math.max(0, options.waitMs ?? DEFAULT_WAIT_MS);

  if (!TX_HASH_PATTERN.test(String(hash ?? ""))) {
    return { verified: false, reason: `"${String(hash)}" is not a valid transaction hash.` };
  }

  const getReceipt = options.getReceipt ?? readReceiptFromChain;
  let lastError = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    let receipt: SettlementReceipt | null = null;
    try {
      receipt = await getReceipt(hash);
    } catch (err) {
      lastError = describeError(err);
    }

    if (receipt) return verifyX402Receipt(receipt, options.payer);
  }

  const waited = Math.round(((attempts - 1) * waitMs) / 1000);
  return {
    verified: false,
    reason:
      `the transaction receipt for ${hash} was not readable from the Base Sepolia RPC ` +
      `after about ${waited} second${waited === 1 ? "" : "s"} of polling` +
      `${lastError ? ` (last RPC error: ${lastError})` : ""}.`,
  };
}

// ───────────────────────── the double-pay guard ─────────────────────────

/**
 * A USDC Transfer found on chain that matches a settlement we were expecting.
 * Plain JSON (strings only), same reason as SettlementVerification.
 */
export type SettlementTransfer = {
  /** Block the Transfer was mined in. */
  blockNumber: string;
  /** Transaction that carried it. */
  transactionHash: string;
  /** Transfer sender (the agent wallet). */
  from: string;
  /** Transfer recipient. */
  to: string;
  /** Transfer value in base units, as a decimal string. */
  value: string;
};

/** Reading logs is heavier than a receipt, so the guard's defaults are shorter. */
const GUARD_ATTEMPTS = 4;
const GUARD_WAIT_MS = 2000;
/** Public RPC caps eth_getLogs at a 200-block range; scan in safe chunks. */
const MAX_BLOCK_RANGE = 200n;
/** How far back from the head to look (≈ 5 minutes at Base's ~2s blocks, min 200). */
const GUARD_LOOKBACK_BLOCKS = 300n;

export type FindRecentTransferOptions = {
  /** The agent wallet address that must appear as the Transfer sender. */
  payer: string;
  /** Optional lower bound (inclusive) for the block scan. */
  fromBlock?: bigint;
  /** Optional upper bound (inclusive). Defaults to the current head. */
  toBlock?: bigint;
  /** How many times to poll the scan. Default 4. */
  attempts?: number;
  /** Delay between scan attempts, in ms. Default 2000. */
  waitMs?: number;
  /** Log source / head source. Tests pass fakes so no RPC is contacted. */
  getLogs?: (fromBlock: bigint, toBlock: bigint) => Promise<readonly SettlementReceiptLog[]>;
  getBlockNumber?: () => Promise<bigint>;
};

type RawTransferLog = {
  address?: string;
  topics?: readonly string[];
  data?: string;
  blockNumber?: bigint | number | string;
  transactionHash?: string;
};

/**
 * Turn a raw USDC Transfer log into a matched SettlementTransfer, or null if it
 * is not exactly agent -> payTo for the exact price. Pure.
 */
function matchTransfer(log: RawTransferLog, payer: string): SettlementTransfer | null {
  if (!sameAddress(log?.address ?? "", TOKEN)) return null;
  const topics = Array.isArray(log.topics) ? log.topics : [];
  if (topics.length !== 3 || String(topics[0] ?? "").toLowerCase() !== TRANSFER_EVENT) return null;
  if (!sameAddress(String(topics[1]), payer)) return null;
  if (!sameAddress(String(topics[2]), PAY_TO)) return null;
  let value: bigint;
  try {
    value = BigInt(String(log.data ?? ""));
  } catch {
    return null;
  }
  if (value !== EXPECTED_VALUE) return null;
  return {
    blockNumber: blockLabel((log.blockNumber ?? 0n) as SettlementReceipt["blockNumber"]),
    transactionHash: String(log.transactionHash ?? ""),
    from: String(topics[1]),
    to: String(topics[2]),
    value: value.toString(),
  };
}

/**
 * THE DOUBLE-PAY GUARD.
 *
 * After a `settle_failed`, the facilitator is not trusted: it may have mined the
 * transfer but still reported a failure. Before we spend a second time, scan the
 * last few minutes of USDC Transfer logs for exactly agent -> payTo at the exact
 * price. If one exists, the money already moved and we must NOT retry.
 *
 * Read-only and never throws: any RPC problem simply keeps polling, and the end
 * result is `null` (no transfer found) rather than an error, so the caller can
 * decide. The scan is chunked to respect the public RPC's 200-block getLogs cap.
 */
export async function findRecentTransfer(
  options: FindRecentTransferOptions
): Promise<SettlementTransfer | null> {
  if (!options.payer || addressKey(options.payer) === "") return null;

  const attempts = Math.max(1, options.attempts ?? GUARD_ATTEMPTS);
  const waitMs = Math.max(0, options.waitMs ?? GUARD_WAIT_MS);

  const getLogs =
    options.getLogs ??
    (async (fromBlock: bigint, toBlock: bigint) => {
      try {
        return (await publicClient.getLogs({
          address: TOKEN,
          fromBlock,
          toBlock,
        })) as readonly SettlementReceiptLog[];
      } catch {
        return [];
      }
    });

  const getBlockNumber =
    options.getBlockNumber ?? (() => publicClient.getBlockNumber());

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    let head: bigint;
    try {
      head = await getBlockNumber();
    } catch {
      continue;
    }

    const from = options.fromBlock ?? (head > GUARD_LOOKBACK_BLOCKS ? head - GUARD_LOOKBACK_BLOCKS : 0n);
    const to = options.toBlock ?? head;
    if (to < from) continue;

    let cursor = from;
    while (cursor <= to) {
      const end = cursor + MAX_BLOCK_RANGE - 1n > to ? to : cursor + MAX_BLOCK_RANGE - 1n;
      let logs: readonly SettlementReceiptLog[];
      try {
        logs = await getLogs(cursor, end);
      } catch {
        logs = [];
      }
      for (const log of logs) {
        const matched = matchTransfer(log as RawTransferLog, options.payer);
        if (matched) return matched;
      }
      cursor = end + 1n;
    }
  }

  return null;
}
