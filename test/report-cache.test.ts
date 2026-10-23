import { test } from "node:test";
import assert from "node:assert/strict";
import { getTicketHistoryReport } from "../agent/tools";
import {
  ReportCache,
  type CacheablePaidReport,
} from "../agent/report-cache";
import { REPORT_CACHE } from "../agent/x402-config";

const PAY_TO = "0xDc672f03ec6226B31E45347402af077eCb595559";
const CTX = { baseUrl: "https://ovelo.test" };

function paidResult(
  ticketId = "OV-1001",
  options: { txHash?: string; blockNumber?: string; verified?: boolean; data?: unknown } = {}
): CacheablePaidReport {
  const txHash = options.txHash ?? "0xabc";
  const verified = options.verified ?? true;
  return {
    data: options.data ?? {
      reportType: "ticket-history-report",
      ticket: { id: ticketId },
    },
    payment: {
      status: 200,
      amount: "0.01 USDC",
      to: PAY_TO,
      settlement: { success: true, transaction: txHash, network: "eip155:84532" },
      txHash,
      url: `https://sepolia.basescan.org/tx/${txHash}`,
      verified,
      verifyReason: verified ? undefined : "the transaction receipt was not readable yet.",
      blockNumber: verified ? options.blockNumber ?? "48404488" : undefined,
    },
  };
}

test("first call pays and caches; a later call reuses it with no new payment", async () => {
  let now = Date.UTC(2026, 0, 1);
  const cache = new ReportCache({ now: () => now });
  let calls = 0;
  const pay = async () => {
    calls += 1;
    return paidResult("OV-1001");
  };

  const first = await getTicketHistoryReport("ov-1001", CTX, { pay, cache });
  assert.equal(calls, 1);
  assert.equal(first.reused, undefined);

  now += 30_000;
  const second = await getTicketHistoryReport("OV-1001", CTX, { pay, cache });

  assert.equal(calls, 1);
  assert.equal(second.reused, true);
  assert.equal(second.reusedFromTxHash, "0xabc");
  assert.equal(second.blockNumber, "48404488");
  assert.equal(second.ageSeconds, 30);
  assert.deepEqual(second.data, first.data);
  assert.equal(second.payment?.amount, "0.01 USDC");
});

test("the report expires after 10 minutes and the next check pays again", async () => {
  let now = 0;
  const cache = new ReportCache({ now: () => now });
  let calls = 0;
  const pay = async () => {
    calls += 1;
    return paidResult("OV-1002", { txHash: `0x${calls}` });
  };

  await getTicketHistoryReport("OV-1002", CTX, { pay, cache });

  now = REPORT_CACHE.ttlMs - 1;
  const stillFresh = await getTicketHistoryReport("OV-1002", CTX, { pay, cache });
  assert.equal(calls, 1);
  assert.equal(stillFresh.reused, true);

  now = REPORT_CACHE.ttlMs;
  const expired = await getTicketHistoryReport("OV-1002", CTX, { pay, cache });
  assert.equal(calls, 2);
  assert.equal(expired.reused, undefined);
  assert.equal(expired.payment?.txHash, "0x2");
});

test("a failed payment is never cached", async () => {
  const cache = new ReportCache({ now: () => 0 });
  let calls = 0;
  const pay = async () => {
    calls += 1;
    if (calls === 1) throw new Error("Paid call limit reached, try again later.");
    return paidResult("OV-1001");
  };

  await assert.rejects(
    () => getTicketHistoryReport("OV-1001", CTX, { pay, cache }),
    /Paid call limit reached/
  );
  assert.equal(cache.size, 0);

  const retry = await getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  assert.equal(calls, 2);
  assert.equal(retry.reused, undefined);
  assert.equal(cache.size, 1);
});

test("a paid-but-unverified report is cached and keeps its unverified flag", async () => {
  const cache = new ReportCache({ now: () => 0 });
  const pay = async () => paidResult("OV-1002", { txHash: "0xunverified", verified: false });

  const first = await getTicketHistoryReport("OV-1002", CTX, { pay, cache });
  assert.equal(first.payment?.verified, false);
  assert.equal(first.reused, undefined);

  const second = await getTicketHistoryReport("OV-1002", CTX, { pay, cache });
  assert.equal(second.reused, true);
  assert.equal(second.reusedFromTxHash, "0xunverified");
  assert.equal(second.payment?.verified, false);
  assert.equal(second.payment?.verifyReason, "the transaction receipt was not readable yet.");
  assert.equal(second.blockNumber, undefined);
});

test("different tickets are cached separately", async () => {
  const cache = new ReportCache({ now: () => 0 });
  let calls = 0;
  const pay = async (url: string) => {
    calls += 1;
    const id = url.includes("OV-1002") ? "OV-1002" : "OV-1001";
    return paidResult(id, { txHash: `0x${id}` });
  };

  const one = await getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  const two = await getTicketHistoryReport("OV-1002", CTX, { pay, cache });
  assert.equal(calls, 2);
  assert.equal(one.payment?.txHash, "0xOV-1001");
  assert.equal(two.payment?.txHash, "0xOV-1002");

  const reusedOne = await getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  assert.equal(calls, 2);
  assert.equal(reusedOne.reused, true);
  assert.equal(reusedOne.reusedFromTxHash, "0xOV-1001");
});

test("at most 50 entries are kept and the oldest is evicted", () => {
  const cache = new ReportCache({ now: () => 0, maxEntries: REPORT_CACHE.maxEntries });

  for (let i = 0; i < REPORT_CACHE.maxEntries; i += 1) {
    cache.set(`T-${i}`, paidResult(`T-${i}`, { txHash: `0x${i}` }));
  }
  assert.equal(cache.size, REPORT_CACHE.maxEntries);

  cache.set("T-50", paidResult("T-50", { txHash: "0x50" }));

  assert.equal(cache.size, REPORT_CACHE.maxEntries);
  assert.equal(cache.get("T-0"), null);
  assert.ok(cache.get("T-1"));
  assert.ok(cache.get("T-50"));
});

test("concurrent checks of the same ticket share one payment", async () => {
  const cache = new ReportCache({ now: () => 0 });
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pay = async () => {
    calls += 1;
    await gate;
    return paidResult("OV-1001");
  };

  const first = getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  const second = getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  assert.equal(calls, 1);

  release();
  const [a, b] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(a.reused, undefined);
  assert.equal(b.reused, true);
  assert.equal(cache.size, 1);
});

test("a failed in-flight payment rejects both waiters and caches nothing", async () => {
  const cache = new ReportCache({ now: () => 0 });
  let calls = 0;
  let fail!: () => void;
  const gate = new Promise<void>((_resolve, reject) => {
    fail = () => reject(new Error("payment failed"));
  });
  const pay = async () => {
    calls += 1;
    await gate;
    return paidResult("OV-1001");
  };

  const first = getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  const second = getTicketHistoryReport("OV-1001", CTX, { pay, cache });
  assert.equal(calls, 1);

  fail();
  await assert.rejects(first, /payment failed/);
  await assert.rejects(second, /payment failed/);
  assert.equal(cache.size, 0);
});

test("an unknown ticket id is never cached", async () => {
  const cache = new ReportCache({ now: () => 0 });
  let calls = 0;
  const pay = async () => {
    calls += 1;
    return { data: { error: "No ticket history found", validTicketIds: ["OV-1001"] } };
  };

  const first = await getTicketHistoryReport("OV-9999", CTX, { pay, cache });
  const second = await getTicketHistoryReport("OV-9999", CTX, { pay, cache });

  assert.equal(calls, 2);
  assert.equal(first.reused, undefined);
  assert.equal(second.reused, undefined);
  assert.equal(cache.size, 0);
});

test("a paid response without a delivered ticket is never cached", async () => {
  const cache = new ReportCache({ now: () => 0 });
  let calls = 0;
  const pay = async () => {
    calls += 1;
    return { data: { error: "No ticket history found" }, payment: paidResult().payment };
  };

  await getTicketHistoryReport("OV-9999", CTX, { pay, cache });
  await getTicketHistoryReport("OV-9999", CTX, { pay, cache });

  assert.equal(calls, 2);
  assert.equal(cache.size, 0);
});
