import { test } from "node:test";
import assert from "node:assert/strict";
import {
  verifyX402Receipt,
  verifyX402Settlement,
  findRecentTransfer,
  type SettlementReceipt,
} from "../agent/x402-verify";
import { X402 } from "../agent/x402-config";

/**
 * Unit tests for OUR OWN settlement verification. Every receipt here is a fake
 * object built by hand — no network, no RPC, no payment, no real transaction.
 */

/** The agent wallet that pays for the API calls (public address, no key). */
const PAYER = "0x865b100A911a0eEA2ef8781614EB1737526E7683";

/** keccak256("Transfer(address,address,uint256)") — the canonical ERC-20 topic. */
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
/** keccak256("Approval(address,address,uint256)") — same shape, different event. */
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

const TX_HASH = "0xb79eab05b4442f0a1678dc57eca889bdf2a16151b247a38def68889a231f7763";

/** An address as a 32-byte padded log topic. */
function topicOf(address: string): string {
  return `0x${address.replace(/^0x/i, "").toLowerCase().padStart(64, "0")}`;
}

/** A uint256 as hex-encoded log data. */
function dataOf(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

type TransferLogOptions = {
  from?: string;
  to?: string;
  value?: bigint;
  token?: string;
  selector?: string;
  topics?: string[];
};

function transferLog(options: TransferLogOptions = {}) {
  const from = options.from ?? PAYER;
  const to = options.to ?? X402.payTo;
  const value = options.value ?? BigInt(X402.priceBaseUnits);
  const token = options.token ?? X402.token;
  const selector = options.selector ?? TRANSFER_TOPIC;
  return {
    address: token,
    topics: options.topics ?? [selector, topicOf(from), topicOf(to)],
    data: dataOf(value),
  };
}

function receipt({
  status = "success",
  blockNumber = 48404488n,
  logs = [transferLog()],
}: {
  status?: string;
  blockNumber?: bigint | number | string;
  logs?: SettlementReceipt["logs"];
}): SettlementReceipt {
  return { status, blockNumber, logs };
}

// ───────────────────────── pure receipt checks ─────────────────────────

test("a correct receipt is verified and reports block, sender, recipient and amount", () => {
  const result = verifyX402Receipt(receipt({}), PAYER);
  assert.equal(result.verified, true);
  if (!result.verified) return;
  assert.equal(result.blockNumber, "48404488");
  assert.equal(result.from.toLowerCase(), topicOf(PAYER).toLowerCase());
  assert.equal(result.to.toLowerCase(), topicOf(X402.payTo).toLowerCase());
  assert.equal(result.value, "10000");
  assert.equal(BigInt(result.value), 10000n);
});

test("addresses compare case-insensitively (checksummed vs lower-case)", () => {
  const result = verifyX402Receipt(
    receipt({ logs: [transferLog({ from: PAYER.toLowerCase(), to: X402.payTo.toLowerCase() })] }),
    PAYER.toLowerCase()
  );
  assert.equal(result.verified, true);
});

test("a Transfer to the wrong recipient is refused", () => {
  const result = verifyX402Receipt(
    receipt({ logs: [transferLog({ to: "0x000000000000000000000000000000000000dead" })] }),
    PAYER
  );
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /recipient/i);
  assert.match(result.reason, /48404488/);
});

test("a Transfer from the wrong sender is refused", () => {
  const result = verifyX402Receipt(
    receipt({ logs: [transferLog({ from: "0x000000000000000000000000000000000000beef" })] }),
    PAYER
  );
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /sender/i);
  assert.match(result.reason, /agent wallet/i);
});

test("a Transfer of the wrong amount is refused", () => {
  const result = verifyX402Receipt(receipt({ logs: [transferLog({ value: 9999n })] }), PAYER);
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /amount/i);
  assert.match(result.reason, /10000/);

  const tooMuch = verifyX402Receipt(receipt({ logs: [transferLog({ value: 20000n })] }), PAYER);
  assert.equal(tooMuch.verified, false);
});

test("a reverted transaction is refused before any log is looked at", () => {
  const result = verifyX402Receipt(receipt({ status: "reverted" }), PAYER);
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /status/i);
  assert.match(result.reason, /reverted/);
});

test("a receipt with no logs at all is refused", () => {
  const result = verifyX402Receipt(receipt({ logs: [] }), PAYER);
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /no log from the USDC token/i);
  assert.ok(result.reason.includes(X402.token));
});

test("a Transfer emitted by a different contract is refused", () => {
  const result = verifyX402Receipt(
    receipt({ logs: [transferLog({ token: "0x1111111111111111111111111111111111111111" })] }),
    PAYER
  );
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /no log from the USDC token/i);
});

test("a different event with the very same shape is refused", () => {
  // Same token address, same 3 topics, same data layout — but it is an Approval.
  const result = verifyX402Receipt(
    receipt({ logs: [transferLog({ selector: APPROVAL_TOPIC })] }),
    PAYER
  );
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /emitted no Transfer event/i);
});

test("a malformed Transfer log is refused instead of throwing", () => {
  const result = verifyX402Receipt(
    receipt({ logs: [transferLog({ topics: [TRANSFER_TOPIC, topicOf(PAYER)] })] }),
    PAYER
  );
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /malformed/i);

  const noData = verifyX402Receipt(
    receipt({ logs: [{ address: X402.token, topics: [TRANSFER_TOPIC, topicOf(PAYER), topicOf(X402.payTo)], data: "0x" }] }),
    PAYER
  );
  assert.equal(noData.verified, false);
  if (noData.verified) return;
  assert.match(noData.reason, /unreadable value/i);
});

test("a missing receipt or a missing payer is answered, never thrown", () => {
  assert.equal(verifyX402Receipt(null, PAYER).verified, false);
  assert.equal(verifyX402Receipt(undefined, PAYER).verified, false);
  assert.equal(verifyX402Receipt(receipt({}), "").verified, false);
  assert.equal(verifyX402Receipt({ status: "success", blockNumber: 1n } as any, PAYER).verified, false);
});

test("verification results are plain JSON (they travel through the tool result)", () => {
  const ok = verifyX402Receipt(receipt({}), PAYER);
  const bad = verifyX402Receipt(receipt({ status: "reverted" }), PAYER);
  assert.doesNotThrow(() => JSON.stringify(ok));
  assert.doesNotThrow(() => JSON.stringify(bad));
  assert.deepEqual(JSON.parse(JSON.stringify(ok)), ok);
});

// ───────────────────────── the polling chain read ─────────────────────────

test("verifyX402Settlement polls a lagging RPC until the receipt appears", async () => {
  let calls = 0;
  const result = await verifyX402Settlement(TX_HASH, {
    payer: PAYER,
    attempts: 5,
    waitMs: 1,
    getReceipt: async () => {
      calls += 1;
      return calls < 3 ? null : receipt({});
    },
  });
  assert.equal(result.verified, true);
  assert.equal(calls, 3);
});

test("verifyX402Settlement gives up after the polling window and says why", async () => {
  let calls = 0;
  const result = await verifyX402Settlement(TX_HASH, {
    payer: PAYER,
    attempts: 3,
    waitMs: 1,
    getReceipt: async () => {
      calls += 1;
      return null;
    },
  });
  assert.equal(calls, 3);
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /not readable/i);
  assert.match(result.reason, /Base Sepolia RPC/);
});

test("verifyX402Settlement keeps polling through RPC errors and never throws", async () => {
  const result = await verifyX402Settlement(TX_HASH, {
    payer: PAYER,
    attempts: 2,
    waitMs: 1,
    getReceipt: async () => {
      throw new Error("failed to fetch\nmore detail");
    },
  });
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /last RPC error/);
  assert.ok(!result.reason.includes("\n"), "the reason is a single line");
});

test("verifyX402Settlement rejects a nonsense hash without touching the RPC", async () => {
  let calls = 0;
  const result = await verifyX402Settlement("0xnope", {
    payer: PAYER,
    attempts: 3,
    waitMs: 1,
    getReceipt: async () => {
      calls += 1;
      return receipt({});
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /not a valid transaction hash/i);
});

test("verifyX402Settlement checks the payer against the Transfer sender", async () => {
  const result = await verifyX402Settlement(TX_HASH, {
    payer: "0x000000000000000000000000000000000000aaaa",
    attempts: 1,
    waitMs: 0,
    getReceipt: async () => receipt({}),
  });
  assert.equal(result.verified, false);
  if (result.verified) return;
  assert.match(result.reason, /sender/i);
});

// ───────────────────────── the double-pay guard ─────────────────────────

/** A raw USDC Transfer log as eth_getLogs returns it (with block + tx hash). */
function rawLog(options: TransferLogOptions & { blockNumber?: bigint; transactionHash?: string } = {}) {
  const base = transferLog(options);
  return {
    ...base,
    blockNumber: options.blockNumber ?? 48413342n,
    transactionHash: options.transactionHash ?? TX_HASH,
  };
}

test("findRecentTransfer matches an exact agent -> payTo transfer of the price", async () => {
  const found = await findRecentTransfer({
    payer: PAYER,
    attempts: 1,
    waitMs: 0,
    getBlockNumber: async () => 48413400n,
    getLogs: async () => [rawLog({ blockNumber: 48413342n })],
  });
  assert.ok(found);
  assert.equal(found?.blockNumber, "48413342");
  assert.equal(found?.transactionHash, TX_HASH);
  assert.equal(found?.value, "10000");
  assert.equal(found?.from.toLowerCase(), topicOf(PAYER).toLowerCase());
});

test("findRecentTransfer ignores the wrong recipient, sender, amount or token", async () => {
  const cases: TransferLogOptions[] = [
    { to: "0x000000000000000000000000000000000000dead" },
    { from: "0x000000000000000000000000000000000000beef" },
    { value: 9999n },
    { token: "0x1111111111111111111111111111111111111111" },
    { selector: APPROVAL_TOPIC },
  ];
  for (const bad of cases) {
    const found = await findRecentTransfer({
      payer: PAYER,
      attempts: 1,
      waitMs: 0,
      getBlockNumber: async () => 48413400n,
      getLogs: async () => [rawLog(bad)],
    });
    assert.equal(found, null, `a non-matching transfer must not be found: ${Object.keys(bad).join(",")}`);
  }
});

test("findRecentTransfer returns null (never throws) when the RPC fails", async () => {
  const found = await findRecentTransfer({
    payer: PAYER,
    attempts: 2,
    waitMs: 0,
    getBlockNumber: async () => {
      throw new Error("rpc down");
    },
    getLogs: async () => {
      throw new Error("rpc down");
    },
  });
  assert.equal(found, null);
});

test("findRecentTransfer polls until the log appears (a slow indexer)", async () => {
  let scans = 0;
  const found = await findRecentTransfer({
    payer: PAYER,
    attempts: 5,
    waitMs: 1,
    getBlockNumber: async () => 48413400n,
    getLogs: async () => {
      scans += 1;
      return scans < 3 ? [] : [rawLog()];
    },
  });
  assert.ok(found);
  assert.equal(scans, 3, "it kept polling (three scan rounds) until the log showed up");
});

test("findRecentTransfer chunks a wide block range to respect the getLogs cap", async () => {
  const ranges: Array<[bigint, bigint]> = [];
  await findRecentTransfer({
    payer: PAYER,
    attempts: 1,
    waitMs: 0,
    fromBlock: 0n,
    toBlock: 500n,
    getBlockNumber: async () => 500n,
    getLogs: async (from, to) => {
      ranges.push([from, to]);
      return [];
    },
  });
  assert.ok(ranges.length >= 3, "500 blocks need at least 3 chunks");
  for (const [from, to] of ranges) {
    assert.ok(to - from <= 199n, `chunk ${from}-${to} must be within the 200-block cap`);
  }
});
