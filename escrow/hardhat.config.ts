import { readFileSync } from "node:fs";
import { defineConfig } from "hardhat/config";
import hardhatViem from "@nomicfoundation/hardhat-viem";
import hardhatViemAssertions from "@nomicfoundation/hardhat-viem-assertions";
import hardhatNodeTestRunner from "@nomicfoundation/hardhat-node-test-runner";
import hardhatNetworkHelpers from "@nomicfoundation/hardhat-network-helpers";

/// Loads escrow/.env into process.env (fallback: rely on the real environment).
/// The private keys are never printed anywhere.
function loadEnvFile() {
  try {
    const path = new URL("./.env", import.meta.url);
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !m[0].trim().startsWith("#") && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim();
      }
    }
  } catch {
    // No .env file: variables must already be in the environment.
  }
}

/// Returns a network's account list: the key when it is set, otherwise an empty
/// list. This keeps the Base Sepolia entry defined without requiring any key to
/// load the config, so `hardhat compile` and `hardhat test` run with no
/// environment variables at all. The scripts that actually send transactions
/// check for their own key themselves before sending anything.
function accountsFor(name: string): string[] {
  const value = process.env[name];
  return value ? [value] : [];
}

loadEnvFile();

export default defineConfig({
  solidity: "0.8.31",
  networks: {
    // Base Sepolia testnet (TEST money only). Official public RPC from docs.base.org.
    baseSepolia: {
      type: "http",
      chainType: "l1",
      url: "https://sepolia.base.org",
      accounts: accountsFor("DEPLOYER_PRIVATE_KEY"),
    },
  },
  plugins: [
    hardhatViem,
    hardhatViemAssertions,
    hardhatNodeTestRunner,
    hardhatNetworkHelpers,
  ],
});