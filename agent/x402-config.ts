/**
 * PUBLIC x402 CONFIG (Base Sepolia, test network + test money only).
 *
 * The values are public by nature: they are the payment requirements the API
 * advertises in its 402 response, plus the public test-USDC token address on
 * Base Sepolia (the same token the escrow uses, see agent/escrow-config.ts).
 * Nothing here is a secret. Do not put keys in this file.
 *
 * Not imported by any code yet — introduced ahead of the on-chain settlement
 * upgrade so the constants have one home.
 */
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
  /** The paid APIs charge 0.01 USDC per request. */
  priceUsd: "0.01",
  /** 0.01 USDC in atomic (base) units: 0.01 * 10^6 = 10000. */
  priceBaseUnits: "10000",
  /** Where the paid APIs' USDC goes (public address of the throwaway x402 receiver wallet). */
  payTo: "0xDc672f03ec6226B31E45347402af077eCb595559",
} as const;
