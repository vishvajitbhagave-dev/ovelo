# Screenshot plan

No screenshots are committed yet. The main README shows visible text placeholders and keeps the real image Markdown inside HTML comments. Uncomment an image only after the file exists.

## Capture rules

- About **1200 px wide**; crop browser chrome where it does not add context.
- **PNG**, under **500 KB** per file.
- Use the live app or a local run with the six demo tickets.
- **Do not capture any secret or `.env` content, private keys, wallet files, API keys, terminal output, browser autofill or personal data.** Use a clean browser profile.
- Test wallet addresses shown by the demo are public, but never include a key, seed phrase or environment value.

| File | What to capture | Suggested state |
| --- | --- | --- |
| `01-tickets.png` | The Tickets tab with the six demo tickets, prices and risk labels | Default ticket list |
| `02-check-high-risk.png` | The Check tab for OV-1002 with score 100, HIGH risk and the refusal to fund | `Check ticket OV-1002` |
| `03-verified-payment-receipt.png` | A paid ticket-history receipt showing the verified-on-chain label, block number and transaction link | Paid report after on-chain verification |
| `04-activity-tab.png` | The Activity tab with checks, refusals, escrow events and paid-call entries | After a few demo actions |
| `05-agent-wallet.png` | The Agent wallet tab with test ETH and test USDC balances | Wallet loaded |
| `06-basescan-transaction.png` | A Basescan transaction page for the escrow fund or check-in | Any recorded transaction from `docs/PROOF.md` |
| `07-basescan-verified-contract.png` | Basescan showing the OveloEscrow source verified against the deployed bytecode | Contract **Code** tab |
| `08-reused-report.png` | A reused paid report labelled as no new payment, with the original block and transaction | Same ticket report requested twice |
| `09-mobile-view.jpeg` | The mobile layout of the Tickets and Check tabs | Narrow viewport |
| `10-health-endpoint.png` | The `/api/health` JSON response with safe status fields | `GET /api/health` |
