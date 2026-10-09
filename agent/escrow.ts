/**
 * SERVER-ONLY escrow module (Base Sepolia, TEST network + TEST money only).
 *
 * This is the ONLY place that touches the escrow wallet keys. It must never be
 * imported by client code and must never return, log or throw a private key.
 * API routes and the agent tool call the functions here; the browser only ever
 * sees public data (addresses, tx hashes, balances, statuses).
 *
 * It talks to the deployed OveloEscrow contract documented in
 * escrow/deployments/baseSepolia.json using viem. It can do exactly two things
 * on-chain: `fund` (approve 1 USDC, then fund a deal) and `checkIn` (the demo
 * scanner releases the deal). Nothing else, and only the known contract.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { ESCROW, BASESCAN } from "./escrow-config";
import { assessTicketRisk, findDemoTicket, type TicketRisk } from "./tickets";

// Belt-and-braces: this module must never run in a browser bundle.
if (typeof window !== "undefined") {
  throw new Error("agent/escrow.ts is server-only and must not be imported by client code.");
}

const CONTRACT = getAddress(ESCROW.contract);
const TOKEN = getAddress(ESCROW.token);
const SELLER = getAddress(ESCROW.seller);
const EXPECTED_SCANNER = getAddress(ESCROW.scanner);

const AMOUNT = BigInt(ESCROW.demoAmountBaseUnits);
const MAX_TOTAL_DEALS = BigInt(ESCROW.maxTotalDeals);
const MIN_AGENT_ETH = BigInt(ESCROW.minAgentEthWei);
const MIN_AGENT_USDC = BigInt(ESCROW.minAgentUsdcBaseUnits);

/** Minimal ABI — only `fund`, `checkIn`, `refund` and read helpers. No other method exists here. */
const escrowAbi = [
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "ticketId", type: "bytes32" },
      { name: "seller", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "dealId", type: "uint256" }],
  },
  {
    type: "function",
    name: "checkIn",
    stateMutability: "nonpayable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getDeal",
    stateMutability: "view",
    inputs: [{ name: "dealId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "dealId", type: "uint256" },
          { name: "ticketId", type: "bytes32" },
          { name: "buyer", type: "address" },
          { name: "seller", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getDealIdForTicket",
    stateMutability: "view",
    inputs: [{ name: "ticketId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "event",
    name: "DealFunded",
    inputs: [
      { name: "dealId", type: "uint256", indexed: true },
      { name: "ticketId", type: "bytes32", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "seller", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "deadline", type: "uint256", indexed: false },
    ],
  },
] as const;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl) });

const AGENT_WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");

/** The agent key: WALLET_PRIVATE_KEY from .env, else the wallet created by the button. */
function loadAgentKey(): Hex | null {
  const fromEnv = process.env.WALLET_PRIVATE_KEY;
  if (fromEnv && /^0x[0-9a-fA-F]{64}$/.test(fromEnv)) return fromEnv as Hex;
  try {
    if (fs.existsSync(AGENT_WALLET_FILE)) {
      const key = JSON.parse(fs.readFileSync(AGENT_WALLET_FILE, "utf8")).privateKey;
      if (typeof key === "string" && /^0x[0-9a-fA-F]{64}$/.test(key)) return key as Hex;
    }
  } catch {
    // fall through to null
  }
  return null;
}

function loadScannerKey(): Hex | null {
  const fromEnv = process.env.SCANNER_PRIVATE_KEY;
  return fromEnv && /^0x[0-9a-fA-F]{64}$/.test(fromEnv) ? (fromEnv as Hex) : null;
}

function agentAccount(): PrivateKeyAccount | null {
  const key = loadAgentKey();
  return key ? privateKeyToAccount(key) : null;
}

function scannerAccount(): PrivateKeyAccount | null {
  const key = loadScannerKey();
  return key ? privateKeyToAccount(key) : null;
}

function requireAgent() {
  const account = agentAccount();
  if (!account) {
    throw new Error(
      "The escrow agent wallet is not configured. Set WALLET_PRIVATE_KEY in .env (a TEST wallet only), then restart."
    );
  }
  return account;
}

function requireScanner() {
  const account = scannerAccount();
  if (!account) {
    throw new Error("The demo scanner is not configured. Set SCANNER_PRIVATE_KEY in .env, then restart.");
  }
  return account;
}

// ───────────────────────────── public types ─────────────────────────────

export type DealStatus = "None" | "Funded" | "Released" | "Refunded";

export const DEAL_STATUS: Record<number, DealStatus> = {
  0: "None",
  1: "Funded",
  2: "Released",
  3: "Refunded",
};

export type PublicDeal = {
  dealId: string;
  ticketId: string;
  buyer: string;
  seller: string;
  amountBaseUnits: string;
  amountUsdc: string;
  deadline: number;
  status: DealStatus;
};

export type TxLink = { kind: "approve" | "fund" | "scan"; hash: string; url: string };

/** A deal that already exists, returned when a duplicate funding is refused. */
export type ExistingDeal = { dealId: string; runId?: string; status: DealStatus };

export type FundOutcome =
  | {
      ok: true;
      dealId: string;
      runId: string;
      ticketKey: string;
      status: DealStatus;
      approveHash: string | null;
      fundHash: string;
      links: TxLink[];
      risk: TicketRisk | null;
    }
  | {
      ok: false;
      refused: true;
      code: "HIGH" | "MEDIUM" | "UNKNOWN_TICKET" | "GUARD" | "ALREADY_OPEN" | "ERROR";
      message: string;
      risk?: TicketRisk;
      existing?: ExistingDeal;
    };

export type ScanOutcome =
  | { ok: true; checkInHash: string; link: string; status: DealStatus }
  | { ok: false; rejected: boolean; message: string; dealStatus?: DealStatus };

export type RefundOutcome =
  | { ok: true; dealId: string; refundHash: string; link: string; status: DealStatus }
  | { ok: false; refused: boolean; code: "GUARD" | "ERROR"; message: string };

export type EscrowStatus = {
  configured: boolean;
  address: string | null;
  eth: string;
  usdc: string;
  usdcBaseUnits: string;
  dealCount: number;
  maxTotalDeals: number;
  network: string;
  contract: string;
  explorer: string;
};

// ───────────────────────────── helpers ─────────────────────────────

/** Short random id so every demo run gets a fresh on-chain ticket. */
export function makeRunId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * The deterministic run id used by the AGENT tool path.
 *
 * It is derived from the ticket id plus a time bucket (ESCROW.fundingWindowSeconds),
 * so if the model calls fund_escrow twice for the same ticket within one window,
 * both calls map to the SAME on-chain ticket key. The contract then refuses the
 * second funding while the first deal is open, which stops duplicate deals.
 * The button flow keeps using a fresh random run id (see makeRunId).
 */
export function runIdFor(ticketId: string, at: number = Date.now()): string {
  const bucket = Math.floor(at / 1000 / ESCROW.fundingWindowSeconds);
  return keccak256(stringToBytes(`${ticketId}:${bucket}`)).slice(2, 10);
}

/** bytes32 ticketId = keccak256(`${ticketId}:${runId}`). The app uses the same. */
export function ticketKeyFor(ticketId: string, runId: string): Hex {
  return keccak256(stringToBytes(`${ticketId}:${runId}`));
}

export function isKnownTicket(ticketId: string): boolean {
  return Boolean(findDemoTicket(ticketId));
}

async function getEthWei(address: Address): Promise<bigint> {
  return publicClient.getBalance({ address });
}

async function getUsdc(address: Address): Promise<bigint> {
  return (await publicClient.readContract({
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  })) as bigint;
}

/**
 * The number of deals the contract has opened. The contract's counter
 * `_nextDealId` is private (no getter), so we read its storage slot directly.
 * It is a state variable of type uint256 and, since the three config values
 * above it are `immutable`, it lives at storage slot 0. `_nextDealId` starts
 * at 1, so deals opened = value - 1. Reads only; no transaction.
 */
export async function readDealCount(): Promise<bigint> {
  try {
    const raw = await publicClient.getStorageAt({ address: CONTRACT, slot: "0x0" });
    const next = raw ? BigInt(raw) : 0n;
    return next > 0n ? next - 1n : 0n;
  } catch {
    return 0n;
  }
}

function toPublicDeal(deal: any): PublicDeal {
  const status = Number(deal.status);
  return {
    dealId: String(deal.dealId),
    ticketId: String(deal.ticketId),
    buyer: String(deal.buyer),
    seller: String(deal.seller),
    amountBaseUnits: String(deal.amount),
    amountUsdc: formatUnits(BigInt(deal.amount), ESCROW.tokenDecimals),
    deadline: Number(deal.deadline),
    status: DEAL_STATUS[status] ?? "None",
  };
}

/** Look up the current deal id for a computed ticket key (0 if never funded). */
export async function getDealIdForKey(ticketKey: Hex): Promise<bigint> {
  return (await publicClient.readContract({
    address: CONTRACT,
    abi: escrowAbi,
    functionName: "getDealIdForTicket",
    args: [ticketKey],
  })) as bigint;
}

/**
 * Read one deal. Reads can lag on a load-balanced RPC, and right after a write a
 * node that has not caught up yet will revert `getDeal` with "OveloEscrow: deal
 * does not exist". That is a stale read, not a real failure, so we return null
 * instead of throwing and let callers poll.
 */
export async function readDeal(dealId: bigint | string): Promise<PublicDeal | null> {
  const id = typeof dealId === "bigint" ? dealId : BigInt(dealId);
  try {
    const deal = await publicClient.readContract({
      address: CONTRACT,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [id],
    });
    return toPublicDeal(deal);
  } catch {
    return null;
  }
}

/** Reads can lag on a load-balanced RPC right after a write; poll until it settles. */
async function readDealUntil(
  dealId: bigint,
  ok: (d: PublicDeal) => boolean,
  attempts = 8
): Promise<PublicDeal | null> {
  let last: PublicDeal | null = null;
  for (let i = 0; i < attempts; i++) {
    last = await readDeal(dealId);
    if (last && ok(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return last;
}

function humanizeRevert(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  const text = String(e?.shortMessage ?? e?.message ?? err);
  const lines = text
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const contractLine = lines.find((s) => s.startsWith("OveloEscrow:"));
  const chosen = contractLine ?? lines[lines.length - 1] ?? text;
  return chosen.replace(/^OveloEscrow:\s*/, "");
}

// ───────────────────────────── public reads ─────────────────────────────

export async function getEscrowStatus(): Promise<EscrowStatus> {
  const account = agentAccount();
  const base: EscrowStatus = {
    configured: Boolean(account),
    address: account?.address ?? null,
    eth: "0",
    usdc: "0",
    usdcBaseUnits: "0",
    dealCount: 0,
    maxTotalDeals: ESCROW.maxTotalDeals,
    network: ESCROW.network,
    contract: CONTRACT,
    explorer: ESCROW.explorer,
  };

  const [dealCount] = await Promise.all([readDealCount().catch(() => 0n)]);
  base.dealCount = Number(dealCount);

  if (account) {
    const [eth, usdc] = await Promise.all([getEthWei(account.address), getUsdc(account.address)]);
    base.eth = formatEther(eth);
    base.usdc = formatUnits(usdc, ESCROW.tokenDecimals);
    base.usdcBaseUnits = usdc.toString();
  }
  return base;
}

export type OpenDeal = {
  dealId: string;
  status: DealStatus;
  buyer: string;
  seller: string;
  amountBaseUnits: string;
  amountUsdc: string;
  amountEth?: string;
  deadline: number;
  expired: boolean;
};

/**
 * Every deal this agent (as buyer) still has open, i.e. Funded and not yet
 * released or refunded. Reads only, never writes. `expired` is true once the
 * deadline has passed, meaning a refund is now possible.
 */
export async function listOpenDeals(): Promise<{ deals: OpenDeal[]; chainTime: number }> {
  const account = agentAccount();
  const agentAddr = account?.address.toLowerCase() ?? null;
  if (!agentAddr) return { deals: [], chainTime: Math.floor(Date.now() / 1000) };

  const block = await publicClient.getBlock();
  const chainTime = Number(block.timestamp);
  const count = await readDealCount().catch(() => 0n);

  const deals: OpenDeal[] = [];
  for (let i = 1n; i <= count; i++) {
    const deal = await readDeal(i).catch(() => null);
    if (!deal) continue;
    if (deal.status !== "Funded") continue;
    if (deal.buyer.toLowerCase() !== agentAddr) continue;
    deals.push({
      dealId: deal.dealId,
      status: deal.status,
      buyer: deal.buyer,
      seller: deal.seller,
      amountBaseUnits: deal.amountBaseUnits,
      amountUsdc: deal.amountUsdc,
      deadline: deal.deadline,
      expired: deal.deadline <= chainTime,
    });
  }
  return { deals, chainTime };
}

// ───────────────────────────── policy ─────────────────────────────

/**
 * The server recomputes the risk itself (never trusts the client or the AI).
 * HIGH is always refused; MEDIUM only proceeds when the UI explicitly approved;
 * LOW is allowed.
 */
type PolicyCode = "HIGH" | "MEDIUM" | "UNKNOWN_TICKET";

export function evaluateFundingPolicy(
  ticketId: string,
  approved: boolean
): { allow: boolean; risk: TicketRisk | null; code?: PolicyCode; message: string } {
  const ticket = findDemoTicket(ticketId);
  if (!ticket) {
    return {
      allow: false,
      risk: null,
      code: "UNKNOWN_TICKET",
      message: `There is no demo ticket with id "${ticketId}", so nothing can be funded.`,
    };
  }

  const risk = assessTicketRisk(ticket);
  if (risk.riskLevel === "HIGH") {
    return {
      allow: false,
      risk,
      code: "HIGH",
      message: `Funding refused: this ticket is HIGH risk. ${risk.reasons.join(" ")}`,
    };
  }
  if (risk.riskLevel === "MEDIUM" && !approved) {
    return {
      allow: false,
      risk,
      code: "MEDIUM",
      message:
        "Funding needs your approval: this ticket is MEDIUM risk. Press \"Approve and fund escrow\" in the app to continue.",
    };
  }
  return { allow: true, risk, message: "Allowed." };
}

// ───────────────────────────── fund ─────────────────────────────

/**
 * Approve exactly 1 USDC (only if needed) and fund a deal for the ticket.
 * Waits for each receipt and returns public tx hashes and Basescan links.
 *
 * `approved` must only be true when it came from the UI approve endpoint; the
 * agent tool never passes it. `runId` is optional: the agent tool passes a
 * deterministic one (runIdFor) so a retry can never open a second deal, while
 * the button flow omits it and gets a fresh random ticket each time.
 *
 * Once the fund transaction is mined this function ALWAYS returns ok:true, even
 * if a lagging RPC node cannot yet read the deal back. It never reports a
 * failure for a funding that really happened.
 */
export async function fundEscrow(input: {
  ticketId: string;
  approved: boolean;
  runId?: string;
}): Promise<FundOutcome> {
  const policy = evaluateFundingPolicy(input.ticketId, input.approved);
  if (!policy.allow) {
    return { ok: false, refused: true, code: policy.code!, message: policy.message, risk: policy.risk ?? undefined };
  }

  try {
    const account = requireAgent();

    // ── Safety guards ────────────────────────────────────────────────
    const [eth, usdc, dealCount] = await Promise.all([
      getEthWei(account.address),
      getUsdc(account.address),
      readDealCount(),
    ]);

    if (eth < MIN_AGENT_ETH) {
      return {
        ok: false,
        refused: true,
        code: "GUARD",
        message: `Funding refused: the agent wallet is low on test ETH (${formatEther(eth)} ETH). Top it up from a Base Sepolia faucet and try again.`,
      };
    }
    if (usdc < MIN_AGENT_USDC) {
      return {
        ok: false,
        refused: true,
        code: "GUARD",
        message: `Funding refused: the agent wallet has ${formatUnits(usdc, ESCROW.tokenDecimals)} test USDC, which is below the 3 USDC safety floor.`,
      };
    }
    if (dealCount >= MAX_TOTAL_DEALS) {
      return {
        ok: false,
        refused: true,
        code: "GUARD",
        message: `Funding refused: the demo has already opened ${dealCount} deals, which is the cap of ${ESCROW.maxTotalDeals}.`,
      };
    }

    // ── Ticket key for this run (deterministic for the agent tool) ────
    const runId = input.runId && /^[0-9a-fA-F]+$/.test(input.runId) ? input.runId : makeRunId();
    const ticketKey = ticketKeyFor(input.ticketId, runId);

    // ── Idempotency: refuse a duplicate BEFORE sending any transaction ─
    // With a deterministic run id a retry maps to the same key; if that key
    // already has an open (or sold) deal we return it instead of funding again.
    const existingId = await getDealIdForKey(ticketKey).catch(() => 0n);
    if (existingId !== 0n) {
      const existing = await readDeal(existingId);
      if (existing && existing.status !== "Refunded") {
        return {
          ok: false,
          refused: true,
          code: "ALREADY_OPEN",
          message:
            existing.status === "Released"
              ? "This ticket's deal was already released at the gate."
              : "This ticket already has an open deal.",
          risk: policy.risk ?? undefined,
          existing: { dealId: existing.dealId, runId, status: existing.status },
        };
      }
    }

    // ── Approve exactly 1 USDC if the allowance is not already enough ─
    let approveHash: string | null = null;
    const allowance = (await publicClient.readContract({
      address: TOKEN,
      abi: erc20Abi,
      functionName: "allowance",
      args: [account.address, CONTRACT],
    })) as bigint;

    if (allowance < AMOUNT) {
      const h = await createWalletClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl), account }).writeContract({
        address: TOKEN,
        abi: erc20Abi,
        functionName: "approve",
        args: [CONTRACT, AMOUNT],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      approveHash = h;
    }

    // ── Fund the deal ────────────────────────────────────────────────
    const fundWallet = createWalletClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl), account });
    const block = await publicClient.getBlock();
    const deadline = block.timestamp + BigInt(ESCROW.deadlineSeconds);

    let fundHash: Hex;
    try {
      fundHash = await fundWallet.writeContract({
        address: CONTRACT,
        abi: escrowAbi,
        functionName: "fund",
        args: [ticketKey, SELLER, AMOUNT, deadline],
      });
    } catch (err) {
      // The contract refuses a second funding for the same ticket key. Turn that
      // into the same friendly "already has an open deal" answer, not an error.
      const msg = humanizeRevert(err);
      if (/already funded|already sold/i.test(msg)) {
        const id = await getDealIdForKey(ticketKey).catch(() => 0n);
        const existing = id !== 0n ? await readDeal(id) : null;
        return {
          ok: false,
          refused: true,
          code: "ALREADY_OPEN",
          message: "This ticket already has an open deal.",
          risk: policy.risk ?? undefined,
          existing: existing ? { dealId: existing.dealId, runId, status: existing.status } : undefined,
        };
      }
      throw err;
    }

    const receipt = await publicClient.waitForTransactionReceipt({ hash: fundHash });

    // ── The tx is mined: never report a failure from here on ─────────
    // Read the deal id (receipt event first, then poll the mapping), but treat
    // any read hiccup on a lagging node as "not readable yet", not a failure.
    let dealId = 0n;
    let deal: PublicDeal | null = null;
    try {
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== CONTRACT.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
          if (decoded.eventName === "DealFunded") {
            dealId = decoded.args.dealId as bigint;
            break;
          }
        } catch {
          // not a DealFunded log; ignore
        }
      }
      if (dealId === 0n) {
        for (let i = 0; i < 8; i++) {
          const found = await getDealIdForKey(ticketKey).catch(() => 0n);
          if (found !== 0n) {
            dealId = found;
            break;
          }
          await new Promise((r) => setTimeout(r, 1200));
        }
      }
      if (dealId !== 0n) {
        deal = await readDealUntil(dealId, () => true);
      }
    } catch {
      // A stale node cannot read it yet; the funding still succeeded.
    }

    const links: TxLink[] = [];
    if (approveHash) links.push({ kind: "approve", hash: approveHash, url: BASESCAN.tx(approveHash) });
    links.push({ kind: "fund", hash: fundHash, url: BASESCAN.tx(fundHash) });

    return {
      ok: true,
      dealId: dealId === 0n ? "" : dealId.toString(),
      runId,
      ticketKey,
      status: deal?.status ?? "Funded",
      approveHash,
      fundHash,
      links,
      risk: policy.risk ?? null,
    };
  } catch (err) {
    return { ok: false, refused: true, code: "ERROR", message: humanizeRevert(err) };
  }
}

// ───────────────────────────── scan ─────────────────────────────

/**
 * The demo scanner checks in (releases the deal). Simulates first, so a second
 * scan is rejected with the contract's own reason and no transaction is sent.
 */
export async function scanAtGate(input: { dealId: bigint | string }): Promise<ScanOutcome> {
  let id: bigint;
  try {
    id = typeof input.dealId === "bigint" ? input.dealId : BigInt(input.dealId);
  } catch {
    return { ok: false, rejected: false, message: "That deal id is not valid." };
  }

  const existing = await readDeal(id);
  if (!existing) {
    return { ok: false, rejected: false, message: `There is no deal with id ${id}.` };
  }

  try {
    const account = requireScanner();

    if ((await getEthWei(account.address)) === 0n) {
      return {
        ok: false,
        rejected: false,
        message: "The demo scanner wallet has no test ETH for gas. Top it up and try again.",
        dealStatus: existing.status,
      };
    }

    // Simulate first: if this reverts (e.g. already scanned), send nothing.
    await publicClient.simulateContract({
      account,
      address: CONTRACT,
      abi: escrowAbi,
      functionName: "checkIn",
      args: [id],
    });
  } catch (err) {
    return {
      ok: false,
      rejected: true,
      message: humanizeRevert(err),
      dealStatus: existing.status,
    };
  }

  try {
    const account = requireScanner();
    const wallet = createWalletClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl), account });
    const hash = await wallet.writeContract({
      address: CONTRACT,
      abi: escrowAbi,
      functionName: "checkIn",
      args: [id],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const deal = await readDealUntil(id, (d) => d.status === "Released");
    return { ok: true, checkInHash: hash, link: BASESCAN.tx(hash), status: deal?.status ?? "Released" };
  } catch (err) {
    return { ok: false, rejected: false, message: humanizeRevert(err) };
  }
}

/**
 * Refund a funded deal back to the buyer (the agent wallet) once its deadline
 * has passed. The server enforces every rule itself: the deal must exist, be
 * Funded, the agent must be the buyer, and the deadline must have passed.
 * Only `refund` is ever sent, and only to the known contract.
 */
export async function refundDeal(input: { dealId: bigint | string }): Promise<RefundOutcome> {
  let id: bigint;
  try {
    id = typeof input.dealId === "bigint" ? input.dealId : BigInt(input.dealId);
  } catch {
    return { ok: false, refused: true, code: "ERROR", message: "That deal id is not valid." };
  }

  try {
    const account = requireAgent();
    const existing = await readDeal(id);
    if (!existing) {
      return {
        ok: false,
        refused: true,
        code: "ERROR",
        message: `There is no deal with id ${id}.`,
      };
    }
    if (existing.status !== "Funded") {
      return {
        ok: false,
        refused: true,
        code: "ERROR",
        message: `Refund is only possible for Funded deals; deal ${id} is currently ${existing.status}.`,
      };
    }
    if (existing.buyer.toLowerCase() !== account.address.toLowerCase()) {
      return {
        ok: false,
        refused: true,
        code: "ERROR",
        message: `Only the buyer can refund. Deal ${id} buyer is ${existing.buyer}.`,
      };
    }

    const block = await publicClient.getBlock();
    if (block.timestamp <= BigInt(existing.deadline)) {
      return {
        ok: false,
        refused: true,
        code: "ERROR",
        message: `The deadline for deal ${id} has not passed yet, so it cannot be refunded.`,
      };
    }

    const wallet = createWalletClient({ chain: baseSepolia, transport: http(ESCROW.rpcUrl), account });
    const hash = await wallet.writeContract({
      address: CONTRACT,
      abi: escrowAbi,
      functionName: "refund",
      args: [id],
    });
    await publicClient.waitForTransactionReceipt({ hash });

    const deal = await readDealUntil(id, (d) => d.status === "Refunded");
    return {
      ok: true,
      dealId: id.toString(),
      refundHash: hash,
      link: BASESCAN.tx(hash),
      status: deal?.status ?? "Refunded",
    };
  } catch (err) {
    return { ok: false, refused: true, code: "ERROR", message: humanizeRevert(err) };
  }
}

/** Confirms the module is pointed at the expected network (84532). */
export async function assertCorrectChain(): Promise<void> {
  const id = await publicClient.getChainId();
  if (id !== ESCROW.chainId) {
    throw new Error(`Wrong network: expected chain ${ESCROW.chainId}, got ${id}.`);
  }
}

export { CONTRACT as ESCROW_CONTRACT, TOKEN as ESCROW_TOKEN, SELLER as ESCROW_SELLER };


