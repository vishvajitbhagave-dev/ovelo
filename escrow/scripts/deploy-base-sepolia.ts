// Deploys OveloEscrow to Base Sepolia and records the result.
//
// Safety:
//  - Uses ONLY the first account of the baseSepolia network (the deployer
//    wallet from escrow/.env). No other transaction is sent.
//  - Never prints, logs or writes any private key.
//  - The only file written (deployments/baseSepolia.json) contains public data.
//
// Run with: npm run deploy:baseSepolia
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deployContract } from "viem/actions";
import { network } from "hardhat";

const TOKEN = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // test USDC on Base Sepolia (6 decimals)
const SCANNER = "0xdcBe6C7861cB7cB29BEc1682d6aE701c6B4cB2b6"; // trusted scanner (test wallet)
const MAX_DEAL_AMOUNT = 5_000_000n; // 5 USDC, in base units (6 decimals)
const CHAIN_ID = 84532;

const here = dirname(fileURLToPath(import.meta.url));
const artifactPath = join(
  here,
  "..",
  "artifacts",
  "contracts",
  "OveloEscrow.sol",
  "OveloEscrow.json"
);
const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));

const { viem, networkName } = await network.create();

const walletClients = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const deployerWallet = walletClients[0];
const deployer = deployerWallet.account;

console.log(`Deploying OveloEscrow to ${networkName} (chain ${CHAIN_ID})...`);
console.log("Deployer:", deployer.address);

const hash = await deployContract(deployerWallet, {
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [TOKEN, SCANNER, MAX_DEAL_AMOUNT],
  account: deployer,
});
console.log(`Deployment tx sent: ${hash}`);

console.log("Waiting for the deployment transaction to be mined...");
const receipt = await publicClient.waitForTransactionReceipt({ hash });
const address = receipt.contractAddress;
if (!address) throw new Error("Deployment succeeded but no contract address was returned");

console.log("");
console.log("Deployed contract address:", address);

// Read the deployed contract's public state back from the chain for comparison.
const onChainToken = await publicClient.readContract({
  address,
  abi: artifact.abi,
  functionName: "token",
});
const onChainScanner = await publicClient.readContract({
  address,
  abi: artifact.abi,
  functionName: "trustedScanner",
});
const onChainMax = (await publicClient.readContract({
  address,
  abi: artifact.abi,
  functionName: "maxDealAmount",
})) as bigint;

console.log("");
console.log("=== Read back from the deployed contract (compare with expected) ===");
console.log("token()          =", onChainToken, "(expected", TOKEN, ")");
console.log("scanner()        =", onChainScanner, "(expected", SCANNER, ")");
console.log("maxDealAmount()  =", onChainMax.toString(), "(expected 5000000 = 5 USDC)");
console.log("");
console.log("Basescan: address", `https://sepolia.basescan.org/address/${address}`);
console.log("Basescan: tx     ", `https://sepolia.basescan.org/tx/${hash}`);

// Record ONLY public deployment data.
const record = {
  network: networkName,
  chainId: CHAIN_ID,
  address,
  deploymentTxHash: hash,
  token: onChainToken,
  scanner: onChainScanner,
  maxDealAmount: onChainMax.toString(),
  deployer: deployer.address,
  deployedAt: new Date().toISOString(),
};

const deploymentsDir = join(here, "..", "deployments");
mkdirSync(deploymentsDir, { recursive: true });
const outPath = join(deploymentsDir, "baseSepolia.json");
writeFileSync(outPath, JSON.stringify(record, null, 2) + "\n");
console.log("");
console.log("Record written to deployments/baseSepolia.json");