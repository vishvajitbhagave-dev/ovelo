/**
 * PUBLIC x402 CONFIG (Base Sepolia, test network + test money only).
 *
 * The values are public by nature: they are the payment requirements the API
 * advertises in its 402 response, plus the public test-USDC token address on
 * Base Sepolia (the same token the escrow uses, see agent/escrow-config.ts).
 * Nothing here is a secret. Do not put keys in this file.
 *
 * Imported by agent/x402-server.ts (what the APIs charge and where the money
 * goes) and agent/x402.ts (the price label shown back to the caller).
 */
/**
 * Paid ticket-report cache (see agent/report-cache.ts).
 *
 * A successful report is reused for 10 minutes, with at most 50 entries kept
 * per server instance. This is an in-memory convenience, not a shared store:
 * on serverless it resets on a cold start and does not span instances.
 */
export const REPORT_CACHE = {
  ttlMs: 10 * 60 * 1000,
  maxEntries: 50,
} as const;

export const X402 = {
  /**
   * CAIP-2 network id for Base Sepolia, as used by the x402 packages.
   * ("eip155:84532" — chain 84532, same as ESCROW.chainId.)
   */
  network: "eip155:84532",
  /**
   * The public x402 testnet facilitator, per the official docs
   * (docs.x402.org quickstarts): it works on Base Sepolia and is intended
   * for development/testnet use only — never for mainnet routes.
   */
  facilitatorUrl: "https://x402.org/facilitator",
  /** Test USDC on Base Sepolia (6 decimals), same token as the escrow. */
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  tokenDecimals: 6,
  /**
   * The token's EIP-712 domain, which the payer signs against
   * (TransferWithAuthorization over { name, version, chainId, verifyingContract }).
   * Both values were read back from the token on Base Sepolia: its
   * DOMAIN_SEPARATOR is exactly the domain built with name "USDC", version "2".
   * Without them the official client refuses to sign.
   */
  tokenName: "USDC",
  tokenVersion: "2",
  /** The paid APIs charge 0.01 USDC per request. */
  priceUsd: "0.01",
  /** 0.01 USDC in atomic (base) units: 0.01 * 10^6 = 10000. */
  priceBaseUnits: "10000",
  /**
   * How long a signed authorization stays valid, in seconds. The payer signs
   * validBefore = now + this, and the resource server advertises it as
   * maxTimeoutSeconds. Kept at 60s: long enough to verify + settle, short enough
   * that a stuck authorization cannot linger. Matches the paid routes' maxDuration.
   */
  maxTimeoutSeconds: 60,
  /** Where the paid APIs' USDC goes (public address of the throwaway x402 receiver wallet). */
  payTo: "0xDc672f03ec6226B31E45347402af077eCb595559",

  // ── Spender safeguards (see agent/x402-limits.ts) ────────────────────────
  /**
   * At most this many paid x402 calls, in total, in any rolling hour. Keeps a
   * runaway agent (or a loop) from draining the throwaway wallet.
   */
  maxPaidCallsPerHour: 10,
  /** At most this many paid x402 calls in any rolling minute. */
  maxPaidCallsPerMinute: 3,
  /**
   * Refuse a paid call when the agent wallet holds less than this much test
   * USDC. Read-only chain read (balanceOf). Kept well above the 0.01 USDC
   * price so a burst of calls cannot accidentally empty the wallet.
   */
  minAgentUsdcBaseUnits: "500000", // 0.5 USDC
} as const;

/**
 * Per-visitor rate limits (in-memory, rolling window). Serverless: per-instance
 * only, reset on cold start; the existing global x402 limits remain the
 * backstop. Never used to log or identify visitors beyond a hashed key.
 */
export const VISITOR_LIMITS = {
  chatPer10m: 20,
  paidPer10m: 5,
  windowMs: 10 * 60 * 1000,
  maxVisitors: 1000,
} as const;
