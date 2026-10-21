/**
 * THE OFFICIAL x402 PAYER (new path, beside the legacy one in agent/wallet.ts)
 *
 * agent/wallet.ts keeps the old hand-rolled sign-message flow working
 * untouched. This module is the official SDK path, using the packages
 * installed in step 2:
 *
 *   1. GET the URL with wrapFetchWithPayment (@x402/fetch).
 *   2. On a 402, the wrapper reads the standard PAYMENT-REQUIRED header,
 *      signs an EIP-3009 authorization with the agent's viem account
 *      (ExactEvmScheme, @x402/evm), and retries with PAYMENT-SIGNATURE.
 *   3. The resource server settles through the facilitator; the settlement
 *      result (including the on-chain transaction hash) comes back in the
 *      PAYMENT-RESPONSE header, decoded via x402HTTPClient.processResponse.
 *
 * The settlement tx hash is reported but NOT yet verified against the
 * chain here — on-chain Transfer-event verification comes in a later step.
 * Any non-settled outcome throws: a failed purchase is never a success.
 *
 * Nothing imports this module yet. No payment is made by importing it.
 */
import fs from "fs";
import path from "path";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, x402Client, x402HTTPClient } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { X402 } from "./x402-config";

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
 * Format atomic USDC units as the same "0.01 USDC" label the legacy flow
 * returns (see payAndFetch in agent/wallet.ts and lib/activity.ts).
 * Falls back to the advertised price when the settled amount is missing
 * or unparseable. Pure — no chain or network access.
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
    /** Settlement facts from the PAYMENT-RESPONSE header (not yet chain-verified). */
    settlement: OfficialSettlement;
    /** Convenience copy of settlement.transaction; null only never — settlement is required. */
    txHash: string;
  };
};

/**
 * Fetch a URL, paying an x402 price with the agent's wallet through the
 * official SDK and the testnet facilitator. Same return shape as the legacy
 * payAndFetch so agent/tools.ts and lib/activity.ts consumers keep working.
 *
 * Throws on: no wallet, transport errors, and any outcome that is not a
 * settled payment (settle_failed / payment_required / settled-without-tx).
 */
export async function payAndFetchOfficial(url: string): Promise<OfficialPayResult> {
  const account = loadAccount();
  if (!account) {
    throw new Error("The agent has no wallet yet. Ask the user to click 'Create wallet' first.");
  }

  const client = new x402Client().register("eip155:*", new ExactEvmScheme(account));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const httpClient = new x402HTTPClient(client);

  const response = await fetchWithPayment(url);
  const result = await httpClient.processResponse(response);

  // The server did not ask for or report any payment — same as the legacy
  // flow's "first response was not a 402": hand back the body, no payment.
  if (result.paymentStatus === "none") {
    return { data: result.body };
  }

  type SettleHeader = {
    success?: boolean;
    errorReason?: string;
    errorMessage?: string;
    transaction?: string;
    network?: string;
    payer?: string;
    amount?: string;
  };
  const header = result.header as SettleHeader | undefined;

  if (result.paymentStatus !== "settled") {
    const detail = header?.errorReason ?? header?.errorMessage;
    throw new Error(
      `The x402 payment was not settled (${result.paymentStatus}${detail ? `: ${detail}` : ""}).`
    );
  }

  const settlement = extractSettlement(header);
  if (!settlement || !settlement.success) {
    throw new Error("The x402 payment reported settled but carried no successful transaction. Not treating it as paid.");
  }

  return {
    data: result.body,
    payment: {
      status: result.status,
      amount: formatUsdcLabel(header?.amount, X402.priceUsd),
      to: X402.payTo,
      settlement,
      txHash: settlement.transaction,
    },
  };
}
