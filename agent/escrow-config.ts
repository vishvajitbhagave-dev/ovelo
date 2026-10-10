/**
 * PUBLIC ESCROW CONFIG (Base Sepolia, test network + test money only).
 *
 * Vercel cannot see the Hardhat artifacts in escrow/, so the app keeps its own
 * copy of the few public values it needs. Nothing here is a secret: it is the
 * same data already committed in escrow/deployments/baseSepolia.json.
 *
 * To point the app at a different deployment, edit `contract`/`token`/`scanner`
 * here to match that deployment's public record. Do not put keys in this file.
 */
export const ESCROW = {
  network: "baseSepolia",
  chainId: 84532,
  /** Official public Base Sepolia RPC; override with BASE_SEPOLIA_RPC_URL if it is slow. */
  rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  explorer: "https://sepolia.basescan.org",

  /** Deployed OveloEscrow (see escrow/deployments/baseSepolia.json). */
  contract: "0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E",
  /** Test USDC on Base Sepolia (6 decimals). */
  token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  tokenDecimals: 6,
  /** The trusted demo scanner baked into the contract at deployment. */
  scanner: "0xdcBe6C7861cB7cB29BEc1682d6aE701c6B4cB2b6",
  /** Every demo deal pays this seller. */
  seller: "0x3c86C6a22564E1515E4628426a3ca6a03C28c04d",

  /** One demo deal is always exactly 1 test USDC (scaled down, see README). */
  demoAmountBaseUnits: "1000000",
  /** Hard cap on how many deals the demo will ever open. */
  maxTotalDeals: 40,
  /** Safety floor: refuse to spend if the agent is this low. */
  // Global cooldown between NEW deals, for both funding paths (button + agent).
  // Funding a new deal within this many seconds of the previous one is refused.
  cooldownSeconds: 20,
  minAgentEthWei: "300000000000000", // 0.0003 ETH (gas for approve + fund)
  minAgentUsdcBaseUnits: "3000000", // 3 USDC
  /** Check-in window for a funded deal. */
  deadlineSeconds: 3600, // now + 1 hour
  /**
   * The agent tool derives its run id from the ticket id + this time bucket
   * (see runIdFor in agent/escrow.ts). A retry inside the same bucket reuses the
   * same ticket key, so the contract refuses a duplicate and no second deal opens.
   */
  fundingWindowSeconds: 600, // 10 minutes
} as const;

export const BASESCAN = {
  tx: (hash: string) => `${ESCROW.explorer}/tx/${hash}`,
  address: (a: string) => `${ESCROW.explorer}/address/${a}`,
};
