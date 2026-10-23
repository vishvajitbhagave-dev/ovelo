import { parseEther } from "viem";
import { ESCROW, BASESCAN } from "../agent/escrow-config";
import { X402 } from "../agent/x402-config";
import type { EscrowStatus } from "../agent/escrow";

export type HealthStatus = "ok" | "degraded";

export type HealthReport = {
  status: HealthStatus;
  time: string;
  appCommitHash?: string;
  network: {
    name: "Base Sepolia";
    chainId: number;
  };
  agent: {
    publicAddress: string | null;
    ethBalance: string;
    usdcBalance: string;
    ethAboveEscrowMinimum: boolean;
    usdcAboveEscrowMinimum: boolean;
    usdcAboveX402PaidCallFloor: boolean;
  };
  escrow: {
    contractAddress: string;
    basescanLink: string;
    openDeals: number;
    dealCap: number;
    totalDeals: number;
  };
  facilitator: {
    reachable: boolean;
    error?: string;
  };
  models: string[];
  flags: {
    geminiKeyConfigured: boolean;
    agentWalletConfigured: boolean;
  };
  issues?: string[];
};

export type HealthInput = {
  now: Date;
  commitSha?: string;
  escrowStatus: EscrowStatus | null;
  openDeals: number;
  facilitatorReachable: boolean;
  models: string[];
  geminiKeyConfigured: boolean;
  agentWalletConfigured: boolean;
  readFailures?: string[];
};

function shortCommitSha(sha: string | undefined): string | undefined {
  const trimmed = sha?.trim();
  if (!trimmed) return undefined;
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;
}

function toBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function toWei(value: string): bigint {
  try {
    return parseEther(value);
  } catch {
    return 0n;
  }
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const issues = new Set(input.readFailures ?? []);
  const escrowStatus = input.escrowStatus;

  if (!escrowStatus) issues.add("escrow_status_unavailable");
  if (!input.agentWalletConfigured) issues.add("agent_wallet_not_configured");
  if (!input.facilitatorReachable) issues.add("facilitator_unreachable");

  const ethBalance = escrowStatus?.eth ?? "0";
  const usdcBalance = escrowStatus?.usdc ?? "0";
  const usdcBaseUnits = toBigInt(escrowStatus?.usdcBaseUnits ?? "0");
  const ethAboveEscrowMinimum = Boolean(escrowStatus) && toWei(ethBalance) >= BigInt(ESCROW.minAgentEthWei);
  const usdcAboveEscrowMinimum = Boolean(escrowStatus) && usdcBaseUnits >= BigInt(ESCROW.minAgentUsdcBaseUnits);
  const usdcAboveX402PaidCallFloor = Boolean(escrowStatus) && usdcBaseUnits >= BigInt(X402.minAgentUsdcBaseUnits);

  if (escrowStatus && !ethAboveEscrowMinimum) issues.add("eth_below_escrow_minimum");
  if (escrowStatus && !usdcAboveEscrowMinimum) issues.add("usdc_below_escrow_minimum");
  if (escrowStatus && !usdcAboveX402PaidCallFloor) issues.add("usdc_below_x402_floor");

  const commitSha = shortCommitSha(input.commitSha);

  return {
    status: issues.size === 0 ? "ok" : "degraded",
    time: input.now.toISOString(),
    ...(commitSha ? { appCommitHash: commitSha } : {}),
    network: {
      name: "Base Sepolia",
      chainId: ESCROW.chainId,
    },
    agent: {
      publicAddress: escrowStatus?.configured ? escrowStatus.address : null,
      ethBalance,
      usdcBalance,
      ethAboveEscrowMinimum,
      usdcAboveEscrowMinimum,
      usdcAboveX402PaidCallFloor,
    },
    escrow: {
      contractAddress: ESCROW.contract,
      basescanLink: BASESCAN.address(ESCROW.contract),
      openDeals: input.openDeals,
      dealCap: ESCROW.maxTotalDeals,
      totalDeals: escrowStatus?.dealCount ?? 0,
    },
    facilitator: input.facilitatorReachable
      ? { reachable: true }
      : { reachable: false, error: "facilitator_unreachable" },
    models: input.models,
    flags: {
      geminiKeyConfigured: input.geminiKeyConfigured,
      agentWalletConfigured: input.agentWalletConfigured,
    },
    ...(issues.size > 0 ? { issues: [...issues] } : {}),
  };
}
