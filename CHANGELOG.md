# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Planned work for Week 2 and Week 3. These items are **not built yet**; the list
mirrors the future scope in the [README](README.md#future-scope-for-week-2-and-week-3).

### Planned

- **Settle x402 payments on-chain on Base Sepolia.** Today the x402 flows (weather and ticket-history report) only sign and verify a payment message; no x402 payment is submitted on-chain.
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
