# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Work for Week 2 and Week 3. It mirrors the future scope in the
[README](README.md#future-scope-for-week-2-and-week-3).

### Added

- **x402 payments settle on-chain on Base Sepolia.** The paid tools (`get_weather`, `get_ticket_history_report`) now pay through the official x402 SDK: `agent/x402.ts` signs the EIP-3009 authorization with the agent wallet and the public `x402.org` facilitator submits the transaction, while `agent/x402-server.ts` fronts `/api/weather` and `/api/ticket-report` with a standard paywall (402 → verify → settle → handler, 404 before 402 for unknown ticket ids). The settlement transaction hash and a Basescan link appear in the Activity log and on the report receipt.
- **Ovelo verifies each x402 settlement itself.** `agent/x402-verify.ts` reads the settlement transaction's receipt back from Base Sepolia with viem and checks the USDC `Transfer` log — token, sender (the agent wallet), receiver (`0xDc672f03…5559`) and amount (`10000` base units). `payAndFetchOfficial` reports `verified`, `verifyReason` and `blockNumber` per payment, and the report receipt, the chat tool badge and the Activity log say "settled on-chain" only when that check passes. If it cannot confirm the transfer, the payment is shown honestly as **paid but not verified on-chain** — never as a failure, and never as free. The read is polled for about 20 seconds to ride out the load-balanced public RPC's lag, and it never throws for "not verified".
- **A spend limit on the paid x402 calls.** `agent/x402-limits.ts` runs before any signing in `payAndFetchOfficial` and refuses with "Paid call limit reached, try again later" when: more than **10 paid calls** have been made in a rolling hour, more than **3** in a rolling minute, or the agent wallet holds less than **0.5 test USDC** (`balanceOf`, read-only). The limits live in `agent/x402-config.ts` (`maxPaidCallsPerHour`, `maxPaidCallsPerMinute`, `minAgentUsdcBaseUnits`). A refused call moves no money and touches no network, and the free/read-only tools are unaffected. **Honest caveat:** the two time limits are counted in memory, so on Vercel they are per serverless instance and reset on cold start — best-effort, not a hard guarantee. The balance floor is a chain read on every call, so it holds everywhere.

### Changed

- **"settled on-chain" is no longer a hardcoded label.** It is now shown only after Ovelo's own on-chain verification (above); an unconfirmed payment gets a neutral/amber "paid, not verified" state instead.

### Removed

- The hand-rolled demo payment flow (`payAndFetch` / `verifyPayment` in `agent/wallet.ts`), which signed a message the API only verified and never settled. The wallet module now only creates, holds and reads the wallet.

### Planned

- **Verify the escrow contract on Basescan.** Publish the source for the deployed contract so anyone can read it on the explorer.
- **Richer gate scanner integration.** Replace the demo **Scan at gate** button with something closer to a real venue check-in.
- **More demo events.** Add more fictional events and tickets beyond **Demo Music Night 2026**.

Not committed to a release (exploratory only): zero-knowledge ideas for private ticket ownership proofs.

## [0.1.0] - 2026-10-12

Week 1 (ovelo.v1). First working demo: an AI agent that checks demo ticket risk
with fixed code rules and holds 1 test USDC per deal in a real escrow contract on
the Base Sepolia test network.

### Added

- Rule-based ticket risk engine in code (`agent/tickets.ts`) with six demo tickets and a `check_ticket_risk` agent tool.
- README with the risk rules, the demo tickets, the tech stack and an honest-limits section.
- Paid x402 ticket-history report API and agent tool (`get_ticket_history_report`).
- Risk card on the Check tab rendered directly from the `check_ticket_risk` result.
- Tickets, Check and Agent wallet tabs wired to real agent data.
- `OveloEscrow` smart contract with Hardhat tests: scanner-gated release and deadline refund.
- Base Sepolia deployment record (public data only) in `escrow/deployments/`.
- Base Sepolia escrow smoke test: fund, scanner check-in, and a rejected second scan.
- Real escrow wiring: agent and button funding, gate scan, refunds, open-deals view, idempotent agent funding and the wallet UI.
- `compare_tickets` and `get_deal_status` tools, safe markdown chat rendering and a compact tools list.
- Model switcher backed by a server-side allowlist of Gemini models.
- Activity tab: a session log of agent decisions, payments and escrow events.
- Automatic tests for the risk rules, funding policy, model allowlist and activity log, plus a GitHub Actions CI workflow.
- MIT LICENSE, `SECURITY.md`, `CHANGELOG.md` and `docs/PROOF.md`.

### Changed

- Made the app deployable: environment-variable wallet support, clearer wallet errors and proxy-safe request origins.
- Raised the demo deal cap to 40, added a 20-second cooldown between new deals, and wait for the token allowance to be visible before funding.

### Fixed

- The Hardhat config no longer requires a private key to compile or test; missing key errors are now clear and only shown by the scripts that actually need a key.
