/**
 * THE AGENT'S WALLET
 *
 * The agent owns a wallet (a private key). It is what pays for things: the
 * escrow sends real testnet transactions with it, and the x402 payer
 * (agent/x402.ts) signs the paid-API purchases with it.
 *
 * You create the wallet with the "Create wallet" button on the page.
 * It is saved in `.agent-wallet.json` so it survives restarts. A
 * `WALLET_PRIVATE_KEY` in `.env` wins over the file.
 *
 * This file only holds, creates and reads the wallet. The payment flows live
 * in agent/escrow.ts (escrow) and agent/x402.ts (paid APIs).
 */
import fs from "fs";
import path from "path";
import { createPublicClient, formatEther, http, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const WALLET_FILE = path.join(process.cwd(), ".agent-wallet.json");
const chain = createPublicClient({ chain: baseSepolia, transport: http() });

/** The wallet from .env or .agent-wallet.json, or null if none was created yet. */
function loadAccount() {
  const key = process.env.WALLET_PRIVATE_KEY || (fs.existsSync(WALLET_FILE) && JSON.parse(fs.readFileSync(WALLET_FILE, "utf8")).privateKey);
  return key ? privateKeyToAccount(key as Hex) : null;
}

function requireAccount() {
  const account = loadAccount();
  if (!account) throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  return account;
}

/** Make a brand new wallet and save it. */
export function createWallet() {
  if (loadAccount()) return getWalletAddress();
  const privateKey = generatePrivateKey();
  try {
    fs.writeFileSync(WALLET_FILE, JSON.stringify({ privateKey }, null, 2));
  } catch (err) {
    throw new Error(
      `Could not save the wallet to ${WALLET_FILE} (${err instanceof Error ? err.message : String(err)}). ` +
        "This server's file system is read-only. On a host like Vercel, set WALLET_PRIVATE_KEY in the " +
        "environment variables instead of using this button."
    );
  }
  return privateKeyToAccount(privateKey).address;
}

export function getWalletAddress() {
  return loadAccount()?.address ?? null;
}

export async function getWalletBalance() {
  const wei = await chain.getBalance({ address: requireAccount().address });
  return `${formatEther(wei)} ETH`;
}
