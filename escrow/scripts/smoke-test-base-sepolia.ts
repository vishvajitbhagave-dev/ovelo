// Smoke test of the deployed OveloEscrow on Base Sepolia.
//
// Sends exactly THREE real transactions (approve, fund, checkIn), then
// SIMULATES a second checkIn (no transaction) to prove it is rejected.
// Records only public data. Never prints, logs or writes any private key.
//
// Run with: npm run smoke:baseSepolia
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, getAddress, http, keccak256, stringToBytes, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { getBlock, readContract, simulateContract, waitForTransactionReceipt, writeContract } from "viem/actions";

const RPC = "https://sepolia.base.org";
const EXPECTED_CHAIN_ID = 84532;

const here = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(
  readFileSync(join(here, "..", "artifacts", "contracts", "OveloEscrow.sol", "OveloEscrow.json"), "utf8")
);
const deployment = JSON.parse(readFileSync(join(here, "..", "deployments", "baseSepolia.json"), "utf8"));

const CONTRACT = getAddress(deployment.address);
const TOKEN = getAddress(deployment.token);
const SCANNER = getAddress(deployment.scanner);
const SELLER = getAddress("0x3c86C6a22564E1515E4628426a3ca6a03C28c04d");
const AGENT = getAddress("0x865b100A911a0eEA2ef8781614EB1737526E7683");

const AMOUNT = 1_000_000n; // 1 USDC (6 decimals)
const TICKET_TEXT = "OV-TEST-0001";
const TICKET_ID = keccak256(stringToBytes(TICKET_TEXT));

const agentKey = process.env.AGENT_PRIVATE_KEY;
const scannerKey = process.env.SCANNER_PRIVATE_KEY;
if (!agentKey || !scannerKey) throw new Error("Missing AGENT_PRIVATE_KEY or SCANNER_PRIVATE_KEY in escrow/.env");

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const agentAccount = privateKeyToAccount(agentKey as `0x${string}`);
const scannerAccount = privateKeyToAccount(scannerKey as `0x${string}`);
const agentWallet = createWalletClient({ chain: baseSepolia, transport: http(RPC), account: agentAccount });
const scannerWallet = createWalletClient({ chain: baseSepolia, transport: http(RPC), account: scannerAccount });

if (agentAccount.address.toLowerCase() !== AGENT.toLowerCase()) throw new Error("AGENT_PRIVATE_KEY does not match the agent address");
if (scannerAccount.address.toLowerCase() !== SCANNER.toLowerCase()) throw new Error("SCANNER_PRIVATE_KEY does not match the scanner address");

async function usdcBalance(addr: `0x${string}`): Promise<bigint> {
  return (await readContract(publicClient, { address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [addr] })) as bigint;
}

// The public Base Sepolia RPC is load-balanced; a read right after a receipt can
// hit a node that has not caught up yet. Poll a read until it matches the
// expected on-chain outcome (reads only, no extra transactions).
async function readUntil<T>(fn: () => Promise<T>, ok: (v: T) => boolean, label: string, attempts = 10): Promise<T> {
  let last!: T;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.warn(`   warning: ${label} still not consistent after ${attempts} reads; using last value`);
  return last;
}

console.log("=== OveloEscrow smoke test on Base Sepolia ===");
console.log("Contract:", CONTRACT);
console.log("Token:   ", TOKEN);
console.log("Agent:   ", AGENT);
console.log("Scanner: ", SCANNER);
console.log("Seller:  ", SELLER);
console.log("Ticket text:    ", TICKET_TEXT);
console.log("Ticket bytes32: ", TICKET_ID);

const chainId = await publicClient.getChainId();
if (chainId !== EXPECTED_CHAIN_ID) throw new Error(`Wrong chain: expected ${EXPECTED_CHAIN_ID}, got ${chainId}`);

const sellerBefore = await usdcBalance(SELLER);
const escrowBefore = await usdcBalance(CONTRACT);
console.log("\nBefore: seller USDC", sellerBefore.toString(), "| escrow USDC", escrowBefore.toString());

// 1) Agent approves the escrow to spend exactly 1 USDC.
console.log("\n1) Agent approves escrow to spend 1 USDC...");
const approveHash = await writeContract(agentWallet, {
  account: agentAccount,
  address: TOKEN,
  abi: erc20Abi,
  functionName: "approve",
  args: [CONTRACT, AMOUNT],
});
console.log("   approve tx:", approveHash);
await waitForTransactionReceipt(publicClient, { hash: approveHash });
console.log("   approve confirmed");

// 2) Agent funds the deal.
console.log("\n2) Agent funds ticket for 1 USDC (deadline = now + 1 hour)...");
const block = await getBlock(publicClient);
const deadline = block.timestamp + 3600n;
const fundHash = await writeContract(agentWallet, {
  account: agentAccount,
  address: CONTRACT,
  abi: artifact.abi,
  functionName: "fund",
  args: [TICKET_ID, SELLER, AMOUNT, deadline],
});
console.log("   fund tx:", fundHash);
await waitForTransactionReceipt(publicClient, { hash: fundHash });
console.log("   fund confirmed");

const dealId = await readUntil(
  async () =>
    (await readContract(publicClient, {
      address: CONTRACT,
      abi: artifact.abi,
      functionName: "getDealIdForTicket",
      args: [TICKET_ID],
    })) as bigint,
  (v) => v !== 0n,
  "dealId for ticket"
);
const dealAfterFund = await readUntil(
  async () =>
    (await readContract(publicClient, {
      address: CONTRACT,
      abi: artifact.abi,
      functionName: "getDeal",
      args: [dealId],
    })) as any,
  (d) => d.status === 1, // Funded
  "deal status after fund"
);
console.log("   dealId:", dealId.toString(), "| status:", dealAfterFund.status.toString(), "(1 = Funded)");

// 3) Scanner checks in.
console.log("\n3) Scanner checks in...");
const checkInHash = await writeContract(scannerWallet, {
  account: scannerAccount,
  address: CONTRACT,
  abi: artifact.abi,
  functionName: "checkIn",
  args: [dealId],
});
console.log("   checkIn tx:", checkInHash);
await waitForTransactionReceipt(publicClient, { hash: checkInHash });
const dealAfterCheckIn = await readUntil(
  async () =>
    (await readContract(publicClient, {
      address: CONTRACT,
      abi: artifact.abi,
      functionName: "getDeal",
      args: [dealId],
    })) as any,
  (d) => d.status === 2, // Released
  "deal status after checkIn"
);
console.log("   status after checkIn:", dealAfterCheckIn.status.toString(), "(2 = Released)");

// 4) Balances after release.
const sellerAfter = await readUntil(() => usdcBalance(SELLER), (v) => v - sellerBefore === AMOUNT, "seller balance after release");
const escrowAfter = await readUntil(() => usdcBalance(CONTRACT), (v) => v === 0n, "escrow balance after release");
console.log("\n4) Balances after release");
console.log("   seller USDC before:", sellerBefore.toString());
console.log("   seller USDC after: ", sellerAfter.toString());
console.log("   delta:             ", (sellerAfter - sellerBefore).toString(), "(expected 1000000)");
console.log("   escrow USDC:       ", escrowAfter.toString(), "(expected 0)");

// 5) Simulate a second checkIn (no transaction sent).
console.log("\n5) Simulating a second checkIn (no transaction sent)...");
let secondScanRevert = "";
try {
  await simulateContract(publicClient, {
    account: scannerAccount,
    address: CONTRACT,
    abi: artifact.abi,
    functionName: "checkIn",
    args: [dealId],
  });
  secondScanRevert = "UNEXPECTED: second checkIn did not revert";
  console.log("   " + secondScanRevert);
} catch (err: any) {
  secondScanRevert = err?.shortMessage ?? err?.message ?? String(err);
  console.log("   revert reason:", secondScanRevert);
}

// 6) Basescan links.
console.log("\n=== Basescan links ===");
console.log("approve:", `https://sepolia.basescan.org/tx/${approveHash}`);
console.log("fund:   ", `https://sepolia.basescan.org/tx/${fundHash}`);
console.log("checkIn:", `https://sepolia.basescan.org/tx/${checkInHash}`);
console.log("contract:", `https://sepolia.basescan.org/address/${CONTRACT}`);

// 7) Write public record only.
const record = {
  network: "baseSepolia",
  chainId: EXPECTED_CHAIN_ID,
  ticketTextId: TICKET_TEXT,
  ticketIdBytes32: TICKET_ID,
  dealId: dealId.toString(),
  txHashes: { approve: approveHash, fund: fundHash, checkIn: checkInHash },
  amountUsdcBaseUnits: AMOUNT.toString(),
  addresses: { contract: CONTRACT, token: TOKEN, agent: AGENT, scanner: SCANNER, seller: SELLER },
  statusAfterFund: dealAfterFund.status.toString(),
  statusAfterCheckIn: dealAfterCheckIn.status.toString(),
  balances: {
    sellerBefore: sellerBefore.toString(),
    sellerAfter: sellerAfter.toString(),
    sellerDelta: (sellerAfter - sellerBefore).toString(),
    escrowBefore: escrowBefore.toString(),
    escrowAfter: escrowAfter.toString(),
  },
  secondScanRevert,
  ranAt: new Date().toISOString(),
};
const outDir = join(here, "..", "deployments");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "smoke-test-baseSepolia.json"), JSON.stringify(record, null, 2) + "\n");
console.log("\nRecord written to deployments/smoke-test-baseSepolia.json");
console.log("Smoke test completed.");
