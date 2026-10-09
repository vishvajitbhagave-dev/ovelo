// Refund funded OveloEscrow deals back to the agent (buyer) on Base Sepolia.
//
// A deal can only be refunded when it is still Funded (the scanner never
// released it) and its deadline has passed. This script reads the chain first,
// lists every deal, refunds only the qualifying ones, and records public data
// only. It never prints, logs or writes any private key.
//
// Run with: npm run refund:baseSepolia
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, getAddress, http, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  getBlock,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from "viem/actions";

const RPC = "https://sepolia.base.org";
const EXPECTED_CHAIN_ID = 84532;

const here = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(
  readFileSync(join(here, "..", "artifacts", "contracts", "OveloEscrow.sol", "OveloEscrow.json"), "utf8")
);
const deployment = JSON.parse(readFileSync(join(here, "..", "deployments", "baseSepolia.json"), "utf8"));

const CONTRACT = getAddress(deployment.address);
const TOKEN = getAddress(deployment.token);
const AGENT = getAddress("0x865b100A911a0eEA2ef8781614EB1737526E7683");

const agentKey = process.env.AGENT_PRIVATE_KEY;
if (!agentKey) throw new Error("Missing AGENT_PRIVATE_KEY in escrow/.env");

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const agentAccount = privateKeyToAccount(agentKey as `0x${string}`);
const agentWallet = createWalletClient({ chain: baseSepolia, transport: http(RPC), account: agentAccount });

if (agentAccount.address.toLowerCase() !== AGENT.toLowerCase()) {
  throw new Error("AGENT_PRIVATE_KEY does not match the agent address");
}

async function usdcBalance(addr: `0x${string}`): Promise<bigint> {
  return (await readContract(publicClient, {
    address: TOKEN,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  })) as bigint;
}

async function getDeal(dealId: bigint): Promise<any> {
  return readContract(publicClient, {
    address: CONTRACT,
    abi: artifact.abi,
    functionName: "getDeal",
    args: [dealId],
  });
}

// The public RPC is load-balanced; a read right after a receipt can hit a node
// that has not caught up yet. Poll a read until it matches, no extra tx.
async function readUntil<T>(fn: () => Promise<T>, ok: (v: T) => boolean, label: string, attempts = 10): Promise<T> {
  let last!: T;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`   warning: ${label} not consistent after ${attempts} reads; using last value`);
  return last;
}

// The contract's counter `_nextDealId` is private (no getter) and lives at
// storage slot 0 (the fields above it are immutable). It starts at 1.
async function readNextDealId(): Promise<bigint> {
  const raw = await publicClient.getStorageAt({ address: CONTRACT, slot: "0x0" });
  const next = raw ? BigInt(raw) : 0n;
  return next > 0n ? next : 1n;
}

const STATUS = ["None", "Funded", "Released", "Refunded"];

console.log("=== OveloEscrow refunds on Base Sepolia ===");
console.log("Contract:", CONTRACT);
console.log("Token:   ", TOKEN);
console.log("Agent:   ", AGENT);

const chainId = await publicClient.getChainId();
if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${chainId}`);

const block = await getBlock(publicClient);
const now = block.timestamp;
const next = await readNextDealId();
const count = next - 1n;

console.log("\nChain time:", now.toString(), "| deals opened:", count.toString());

type Candidate = { dealId: bigint; status: number; buyer: `0x${string}`; deadline: bigint };

const candidates: Candidate[] = [];
for (let i = 1n; i <= count; i++) {
  const d = await getDeal(i).catch(() => null);
  if (!d) continue;
  candidates.push({ dealId: i, status: Number(d.status), buyer: d.buyer, deadline: BigInt(d.deadline) });
}

console.log("\nDeals:");
for (const c of candidates) {
  console.log(
    `  #${c.dealId} ${STATUS[c.status] ?? c.status} deadline=${c.deadline} buyer=${c.buyer}`
  );
}

const qualifying = candidates.filter(
  (c) =>
    c.status === 1 &&
    c.buyer.toLowerCase() === AGENT.toLowerCase() &&
    c.deadline < now
);

if (qualifying.length === 0) {
  console.log("\nNo refundable deals (need status Funded, agent as buyer, deadline passed).");
  process.exit(0);
}

console.log(`\nRefundable: ${qualifying.map((c) => "#" + c.dealId).join(", ")}`);

const escrowBefore = await usdcBalance(CONTRACT);
const agentBefore = await usdcBalance(AGENT);
console.log("Before: escrow USDC", escrowBefore.toString(), "| agent USDC", agentBefore.toString());

const receipts: { dealId: string; txHash: string; statusAfter: number }[] = [];

for (const c of qualifying) {
  console.log(`\nRefunding deal #${c.dealId}...`);
  const txHash = await writeContract(agentWallet, {
    account: agentAccount,
    address: CONTRACT,
    abi: artifact.abi,
    functionName: "refund",
    args: [c.dealId],
  });
  console.log("   refund tx:", txHash);
  await waitForTransactionReceipt(publicClient, { hash: txHash });

  const after = await readUntil(
    async () => (await getDeal(c.dealId)) as any,
    (d) => Number(d.status) === 3, // Refunded
    `deal #${c.dealId} status after refund`
  );
  console.log("   status after refund:", Number(after.status), "(3 = Refunded)");
  receipts.push({ dealId: c.dealId.toString(), txHash, statusAfter: Number(after.status) });
}

const escrowAfter = await readUntil(() => usdcBalance(CONTRACT), (v) => v === escrowBefore - BigInt(qualifying.length) * 1_000_000n, "escrow balance after refunds");
const agentAfter = await readUntil(() => usdcBalance(AGENT), (v) => v === agentBefore + BigInt(qualifying.length) * 1_000_000n, "agent balance after refunds");

console.log("\nAfter:  escrow USDC", escrowAfter.toString(), "| agent USDC", agentAfter.toString());
console.log("Escrow delta:", (escrowAfter - escrowBefore).toString());
console.log("Agent delta: ", (agentAfter - agentBefore).toString());

console.log("\n=== Basescan links ===");
for (const r of receipts) {
  console.log(`deal #${r.dealId}:`, `https://sepolia.basescan.org/tx/${r.txHash}`);
}

const record = {
  network: "baseSepolia",
  chainId: EXPECTED_CHAIN_ID,
  refunds: receipts,
  addresses: { contract: CONTRACT, token: TOKEN, agent: AGENT },
  amountUsdcBaseUnits: "1000000",
  balances: {
    escrowBefore: escrowBefore.toString(),
    escrowAfter: escrowAfter.toString(),
    agentBefore: agentBefore.toString(),
    agentAfter: agentAfter.toString(),
  },
  ranAt: new Date().toISOString(),
};
const outDir = join(here, "..", "deployments");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "refund-baseSepolia.json"), JSON.stringify(record, null, 2) + "\n");
console.log("\nRecord written to deployments/refund-baseSepolia.json");
console.log("Refund script completed.");
