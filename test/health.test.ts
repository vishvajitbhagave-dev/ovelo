import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHealthReport, type HealthInput } from "../lib/health";
import { ESCROW } from "../agent/escrow-config";
import { ALLOWED_MODELS } from "../agent/models";

const NOW = new Date("2026-10-23T00:00:00.000Z");

const healthyStatus = {
  configured: true,
  address: "0x1111111111111111111111111111111111111111",
  eth: "0.001",
  usdc: "5",
  usdcBaseUnits: "5000000",
  dealCount: 7,
  maxTotalDeals: ESCROW.maxTotalDeals,
  network: ESCROW.network,
  contract: ESCROW.contract,
  explorer: ESCROW.explorer,
};

const baseInput: HealthInput = {
  now: NOW,
  commitSha: "abcdef1234567890",
  escrowStatus: healthyStatus,
  openDeals: 1,
  facilitatorReachable: true,
  models: ALLOWED_MODELS.map((model) => model.id),
  geminiKeyConfigured: true,
  agentWalletConfigured: true,
};

test("health report is ok when all checks pass", () => {
  const report = buildHealthReport(baseInput);

  assert.equal(report.status, "ok");
  assert.equal(report.time, NOW.toISOString());
  assert.equal(report.appCommitHash, "abcdef1");
  assert.deepEqual(report.network, { name: "Base Sepolia", chainId: 84532 });
  assert.equal(report.agent.publicAddress, healthyStatus.address);
  assert.equal(report.agent.ethBalance, "0.001");
  assert.equal(report.agent.usdcBalance, "5");
  assert.equal(report.agent.ethAboveEscrowMinimum, true);
  assert.equal(report.agent.usdcAboveEscrowMinimum, true);
  assert.equal(report.agent.usdcAboveX402PaidCallFloor, true);
  assert.equal(report.escrow.contractAddress, ESCROW.contract);
  assert.match(report.escrow.basescanLink, /sepolia\.basescan\.org\/address\//);
  assert.equal(report.escrow.openDeals, 1);
  assert.equal(report.escrow.dealCap, 40);
  assert.equal(report.escrow.totalDeals, 7);
  assert.deepEqual(report.facilitator, { reachable: true });
  assert.deepEqual(report.models, ALLOWED_MODELS.map((model) => model.id));
  assert.deepEqual(report.flags, { geminiKeyConfigured: true, agentWalletConfigured: true });
  assert.equal(report.issues, undefined);
});

test("low balances are flagged and degrade the report", () => {
  const lowEth = buildHealthReport({
    ...baseInput,
    escrowStatus: { ...healthyStatus, eth: "0.0001" },
  });
  assert.equal(lowEth.status, "degraded");
  assert.equal(lowEth.agent.ethAboveEscrowMinimum, false);
  assert.ok(lowEth.issues?.includes("eth_below_escrow_minimum"));

  const belowEscrow = buildHealthReport({
    ...baseInput,
    escrowStatus: { ...healthyStatus, usdc: "2.5", usdcBaseUnits: "2500000" },
  });
  assert.equal(belowEscrow.status, "degraded");
  assert.equal(belowEscrow.agent.usdcAboveEscrowMinimum, false);
  assert.equal(belowEscrow.agent.usdcAboveX402PaidCallFloor, true);
  assert.ok(belowEscrow.issues?.includes("usdc_below_escrow_minimum"));

  const belowX402 = buildHealthReport({
    ...baseInput,
    escrowStatus: { ...healthyStatus, usdc: "0.4", usdcBaseUnits: "400000" },
  });
  assert.equal(belowX402.status, "degraded");
  assert.equal(belowX402.agent.usdcAboveEscrowMinimum, false);
  assert.equal(belowX402.agent.usdcAboveX402PaidCallFloor, false);
  assert.ok(belowX402.issues?.includes("usdc_below_x402_floor"));
});

test("an unreachable facilitator is flagged", () => {
  const report = buildHealthReport({ ...baseInput, facilitatorReachable: false });

  assert.equal(report.status, "degraded");
  assert.deepEqual(report.facilitator, { reachable: false, error: "facilitator_unreachable" });
  assert.ok(report.issues?.includes("facilitator_unreachable"));
});

test("a failed read is named and degrades the report", () => {
  const report = buildHealthReport({
    ...baseInput,
    escrowStatus: null,
    agentWalletConfigured: false,
    openDeals: 0,
    readFailures: ["open_deals_read_failed"],
  });

  assert.equal(report.status, "degraded");
  assert.equal(report.agent.publicAddress, null);
  assert.equal(report.agent.ethBalance, "0");
  assert.equal(report.agent.usdcBalance, "0");
  assert.equal(report.escrow.totalDeals, 0);
  assert.ok(report.issues?.includes("escrow_status_unavailable"));
  assert.ok(report.issues?.includes("open_deals_read_failed"));
  assert.ok(report.issues?.includes("agent_wallet_not_configured"));
});

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

test("health report exposes no secrets, keys, env values or raw RPC URLs", () => {
  const report = buildHealthReport({ ...baseInput, facilitatorReachable: false });
  const json = JSON.stringify(report);
  const keys = collectKeys(report).map((key) => key.toLowerCase());
  const forbiddenKeys = ["privatekey", "private_key", "mnemonic", "rpcurl", "env", "stack", "apikey", "secret"];

  for (const forbidden of forbiddenKeys) {
    assert.equal(keys.includes(forbidden), false, `unexpected field ${forbidden}`);
  }
  assert.doesNotMatch(json, /0x[0-9a-fA-F]{64}/);
  assert.doesNotMatch(json, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.doesNotMatch(json, /(GEMINI_API_KEY|WALLET_PRIVATE_KEY|SCANNER_PRIVATE_KEY|BASE_SEPOLIA_RPC_URL)\s*=/);
  assert.doesNotMatch(json, /https:\/\/sepolia\.base\.org/);
  assert.doesNotMatch(json, /at\s+\S+\s+\(.*:\d+:\d+\)/);
});
