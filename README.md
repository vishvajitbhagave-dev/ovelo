<img src="public/logo.png" alt="Ovelo logo" width="140" />

# Ovelo

[![CI](https://github.com/vishvajitbhagave-dev/ovelo/actions/workflows/ci.yml/badge.svg)](https://github.com/vishvajitbhagave-dev/ovelo/actions/workflows/ci.yml)

**Ovelo helps you buy resale tickets without getting burned — an AI agent that checks the deal, explains the risk, and holds your money in escrow until the ticket is checked at the gate.**

## What Ovelo solves

Buying a resale ticket online is a gamble. The same few things go wrong again and again:

1. **Copied tickets.** Someone photographs a real ticket and sells the same seat twice. The second buyer turns up at the gate and gets nothing.
2. **Already-used tickets.** The ticket was already scanned at the door once, and the seller tries to sell it again.
3. **Fake sellers.** The seller isn't the person the ticket is registered to, the price is wildly over the official resale cap, or the ticket comes from an issuer nobody has ever heard of.
4. **Paying before the check.** You send the money first and only find out at the gate whether the ticket was ever real.

The warning signs are usually visible somewhere in the listing — most buyers just don't know which signs matter.

**How Ovelo helps.** You ask the agent about a ticket. It runs fixed, readable rules in code against the ticket's history, returns a risk level (LOW / MEDIUM / HIGH) with plain reasons, and explains them in everyday words. Then:

- **LOW** → Ovelo can fund the deal itself, into a real escrow on the Base Sepolia test network.
- **MEDIUM** → Ovelo will not spend a cent on its own; a person must press **Approve and fund escrow**.
- **HIGH** → Ovelo refuses outright and explains why.

The money sits in the escrow contract — not with the seller — until the ticket is checked at the gate. If it is never checked, the buyer can get the money back after the deadline. **The risk level always comes from code, never from the AI.**

> **This is a demo with fake data.** Ovelo cannot check real tickets, real sellers, or real event companies. Everything it knows about comes from six made-up demo tickets. See [Honest limits](#honest-limits).

## Tech stack

Installed versions (read from `node_modules` at the time of writing; the escrow versions come from `escrow/`).

| Layer | Package | Version |
| :--- | :--- | :--- |
| App framework | Next.js | 16.3.8 |
| UI runtime | React / React DOM | 19.3.0 |
| Language | TypeScript | 5.9.3 |
| Styling | Tailwind CSS | 4.3.3 |
| Styling | `@tailwindcss/postcss` | 4.3.3 |
| UI components | shadcn CLI (components in `components/ui`) | 4.21.2 |
| UI components | `@base-ui/react` | 1.8.0 |
| UI icons | `lucide-react` | 1.52.0 |
| EVM client | viem | 2.57.3 |
| AI SDK | `@google/genai` (Google Gen AI SDK) | 2.27.0 |
| Contracts | Hardhat | 3.18.1 |
| Contracts | `@openzeppelin/contracts` | 5.6.1 |
| Contracts | Solidity compiler (`solc`, configured in `escrow/hardhat.config.ts`) | 0.8.31 |
| Runtime | Node.js (dev machine; project needs ≥ 20) | v24.13.0 |
| Package manager | npm | 11.6.2 |

## Tools the agent supports

The agent has **9 tools** in total: **7 core tools** and **2 starter demo tools** (`get_weather` and `roll_dice`). Of the 7 core tools, `get_my_wallet` is inherited from the starter kit; the other six are Ovelo-specific: `list_demo_tickets`, `check_ticket_risk`, `get_ticket_history_report`, `fund_escrow`, `compare_tickets` and `get_deal_status`.

| Tool | What it does | Cost type | Origin |
| :--- | :--- | :--- | :--- |
| `list_demo_tickets` | Lists the six demo tickets with id, event, seat and asking price. | Free | Ovelo core tool |
| `check_ticket_risk` | Runs the rule-based risk engine on one ticket and returns the level, score, reasons and recommendation. | Free | Ovelo core tool |
| `get_ticket_history_report` | Buys the paid history report (issuer, face value, ownership timeline, scan status) for one ticket. | x402 paid (0.01 USDC) | Ovelo core tool |
| `fund_escrow` | Funds a **real** Base Sepolia escrow for one ticket with 1 test USDC — allowed for **LOW** risk only. | On-chain | Ovelo core tool |
| `compare_tickets` | Compares two to six demo tickets at once and ranks them from safest to riskiest, with the safest ticket id. | Free | Ovelo core tool |
| `get_deal_status` | Reads one escrow deal's status (Funded, Released or Refunded) with amount, parties, deadline and refundability, or lists the agent's open deals. Read-only. | Free (on-chain read) | Ovelo core tool |
| `get_weather` | Returns the current weather for a city. | x402 paid (0.01 USDC) | Starter demo tool |
| `get_my_wallet` | Returns the agent wallet address and its Base Sepolia ETH balance. | Free | Core tool (inherited from the starter kit) |
| `roll_dice` | Rolls a dice with the given number of sides. | Free | Starter demo tool |

The x402 tools **sign** a payment message with the agent's wallet and the API verifies the signature; today **no x402 payment is settled on-chain** (see [Future scope](#future-scope-for-week-2-and-week-3)). Only `fund_escrow` sends real transactions.

## Supported AI models

Ovelo only runs a fixed, **server-side allowlist** of Gemini models. The server rejects any model name that is not on the list, so an arbitrary model string can never be sent from the browser.

**How to switch:** open the chat panel and use the **Model** dropdown. Your choice applies to the following messages, stays when you press **Clear**, and resets to the default when you refresh the page.

| Model ID | Official version | Notes | Default |
| :--- | :--- | :--- | :--- |
| `gemini-flash-lite-latest` | Alias — Google publishes no fixed version; `-latest` always points to the newest release of the Flash-Lite line. | The model used in this project's demo. | ✅ Default |
| `gemini-3.5-flash-lite` | Stable (GA), released July 21, 2026. | Fast, low-cost Flash-Lite. | |
| `gemini-3.6-flash` | Stable (GA), released July 21, 2026. | Stronger agentic and tool-calling Flash. | |

All three support function calling and were tested with Ovelo's tool calling (a `roll_dice` function call). `gemini-3.8-flash` supports the API but returned a transient `503` during testing, so it is **not** on the allowlist. Any model not listed here is **untested** with Ovelo.

**Default:** the `GEMINI_MODEL` value in `.env` when it names a model on the list; otherwise `gemini-flash-lite-latest`. The allowlist lives in `agent/models.ts`.

## How it works (diagrams)

### System architecture

```mermaid
flowchart TD
  UI["Browser — Tickets · Check · Activity · Agent wallet tabs<br/>+ chat with model switcher"]
  AgentAPI["POST /api/agent<br/>(model allowlist)"]
  Loop{{"Agent loop — agent/agent.ts<br/>Gemini + tools, up to 5 steps"}}
  ReadTools["Read/rule tools — check_ticket_risk, list_demo_tickets,<br/>compare_tickets, get_deal_status"]
  PaidTools["x402 paid tools — get_ticket_history_report, get_weather"]
  FundTool["fund_escrow"]
  Rules["Risk decided in code — agent/tickets.ts"]
  X402["Paid demo APIs — /api/weather, /api/ticket-report"]
  EscrowMod["agent/escrow.ts — server-only keys<br/>approve + fund / checkIn / refund"]
  EscrowAPI["/api/escrow/* routes"]
  Chain[("Base Sepolia — OveloEscrow + test USDC")]
  Buyer["Agent / buyer wallet"]
  Scanner["Demo scanner wallet"]
  Seller["Demo seller 0x3c86…c04d"]

  UI -->|"chat: messages + model"| AgentAPI
  UI -->|"Check: fund / scan / refund"| EscrowAPI
  AgentAPI --> Loop
  Loop --> ReadTools
  Loop --> PaidTools
  Loop --> FundTool
  ReadTools --> Rules
  PaidTools -->|"X-PAYMENT 0.01 USDC — signed, not settled on-chain"| X402
  FundTool --> EscrowMod
  EscrowAPI --> EscrowMod
  EscrowMod -->|"signs with"| Buyer
  EscrowMod -->|"approve + fund"| Chain
  Scanner -->|"checkIn"| Chain
  Chain -->|"release 1 test USDC"| Seller
```

The browser only talks to Next.js API routes. The Gemini agent loop runs on the server and calls the tools, which reach the rule engine, the x402 paid APIs and the escrow module. Only `agent/escrow.ts` holds keys and sends real Base Sepolia testnet transactions, signed by the agent/buyer wallet; the demo scanner wallet releases the funds to the demo seller. x402 payments are signed and verified but not settled on-chain.

### Ticket check and escrow lifecycle

```mermaid
flowchart TD
  Check["Check a demo ticket"] --> Report["Buy the paid history report<br/>(0.01 USDC via x402)"]
  Report --> Risk{"Risk decided by code<br/>agent/tickets.ts"}
  Risk -->|"HIGH (70+)"| High["Refused — reasons shown,<br/>no fund button"]
  Risk -->|"MEDIUM"| Medium["Waiting for a person —<br/>Approve and fund escrow"]
  Risk -->|"LOW"| Fund["Agent funds escrow —<br/>approve 1 USDC + fund"]
  Medium -->|"human approves"| Fund
  Fund --> Deal[("Deal Funded — 1 test USDC<br/>held by OveloEscrow")]
  Deal -->|"scanner checkIn"| Released["Released — 1 test USDC<br/>paid to the seller"]
  Deal -->|"second scan"| Rejected["Rejected — simulated first,<br/>no transaction sent"]
  Deal -->|"no scan, deadline passes"| Refund["Refunded — 1 test USDC<br/>back to the agent wallet"]
```

The risk level comes only from the fixed rules in code: HIGH is always refused, MEDIUM waits for a person to press **Approve and fund escrow**, and LOW may be funded by the agent. A funded deal ends as **Released** (scanner check-in), is **Rejected** on a second scan (simulated first, so nothing is sent), or is **Refunded** to the agent wallet once the deadline passes with no scan.

## Key features

- **Risk rules live in code.** A plain TypeScript function in [`agent/tickets.ts`](agent/tickets.ts) adds up points and buckets the total, so the same ticket always gets the same answer. The AI cannot change a level, score or reason.
- **HIGH is always refused.** Anything scoring 70 or more is blocked, with the reasons shown and no fund button.
- **MEDIUM needs a human.** Ovelo never funds a MEDIUM ticket by itself; a person must press **Approve and fund escrow**.
- **LOW is funded by the agent.** For LOW-risk tickets the agent may place the escrow itself.
- **Activity log.** An **Activity** tab lists, in plain words, every decision and payment of this browser session (risk checks, the paid x402 report, escrow funding, refusals, human approvals, scans, rejections and refunds), newest first, with real amounts, shortened recipients and Basescan links. It is kept in memory only and resets when the page is refreshed.
- **Paid history report via x402.** The agent buys extra background (issuer, face value, ownership timeline, scan status) by signing a 0.01 USDC payment message that the API verifies.
- **Real on-chain escrow on Base Sepolia.** The money is held by [`OveloEscrow`](escrow/contracts/OveloEscrow.sol) at [`0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E`](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E) (chain id 84532), with test money only.
- **Demo gate scanner.** A **Scan at gate** button calls `checkIn` from a trusted demo scanner wallet and releases the money to the seller.
- **A second scan is rejected.** Ovelo simulates the second `checkIn` first, so no transaction is sent and the contract's own reason is shown in plain words.
- **Refund after the deadline.** If the ticket is never scanned, the buyer can get the 1 test USDC back once the one-hour deadline passes.
- **Safety guards.** The server recomputes the risk and re-checks every rule before spending (see [Safety guards](#safety-guards-server-side)).
- **Live deployment.** The app runs as a Next.js app deployable to Vercel (see the live demo link under [Demo videos and links](#demo-videos-and-links)).

### The rules and their scores

| Rule | Score |
| :--- | ---: |
| Ticket has already been scanned at the gate | +100 |
| Seller is not the current owner of the ticket | +100 |
| Ticket issuer is not verified | +80 |
| Asking price is more than **2×** the resale cap | +70 |
| Asking price is above the resale cap, up to 2× | +40 |
| Ticket changed hands less than 10 minutes ago | +25 |

The price rules are mutually exclusive — a ticket gets either +70 or +40, never both. Rules can stack.

| Total score | Risk level | Recommendation |
| :--- | :--- | :--- |
| 70 or more | **HIGH** | do not fund |
| 25 to 69 | **MEDIUM** | ask the buyer to approve first |
| Under 25 | **LOW** | ok to proceed |

### The demo tickets

Six fake tickets for the fictional event **Demo Music Night 2026**.

| Ticket | Seat | Asking price | What stands out | Risk |
| :--- | :--- | ---: | :--- | :--- |
| **OV-1001** | Floor A · Row 4 · Seat 12 | $165 | Owner is selling, issuer verified, under the $180 cap | **LOW** (0) |
| **OV-1002** | Balcony B · Row 11 · Seat 6 | $175 | Already scanned at the gate | **HIGH** (100) |
| **OV-1003** | Floor A · Row 7 · Seat 3 | $190 | Seller isn't the owner, and it's $10 over the $180 cap | **HIGH** (140) |
| **OV-1004** | Floor C · Row 2 · Seat 21 | $480 | More than twice the $200 cap | **HIGH** (70) |
| **OV-1005** | Floor B · Row 9 · Seat 15 | $170 | Issuer is not verified | **HIGH** (80) |
| **OV-1006** | Balcony A · Row 3 · Seat 8 | $230 | Changed hands 2 minutes ago, and it's $30 over the $200 cap | **MEDIUM** (65) |

If you ask about a ticket id that doesn't exist, the agent says so and lists the valid ids instead of failing.

## Demo videos and links

```
Week 1 (ovelo.v1): Demo-video-link
Week 2 (ovelo.v2): Demo-video-link
Week 3 (ovelo.v3): Demo-video-link
```

Live demo: https://ovelo-five.vercel.app/

## Future scope for Week 2 and Week 3

**Planned (not built yet):**

- **Settle x402 payments on-chain on Base Sepolia.** Today the x402 flows (weather and ticket-history report) only sign and verify a payment message; no x402 payment is submitted on-chain. This would move that onto a real settlement.
- **Verify the escrow contract on Basescan.** Publish the source for the deployed contract so anyone can read it on the explorer.
- **Richer gate scanner integration.** Replace the demo **Scan at gate** button with something closer to a real venue check-in.
- **More demo events.** Add more fictional events and tickets beyond **Demo Music Night 2026**.

**Exploratory (clearly *not* planned as a feature, just an idea):**

- **Zero-knowledge ideas for private ticket ownership proofs.** Exploring whether a buyer could prove they own a valid ticket without revealing the ticket details. Nothing here is designed, built, or promised.

## Follow Ovelo

- X / Twitter: https://x.com/0velo_
- Posts about Ovelo tag **@riseinweb3** on X.

## How to run it

**You need:** Node.js 20 or newer (check with `node -v`) and a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

### Step 1. Install

```bash
npm install
```

### Step 2. Add your API key

Open the `.env` file in the project root and paste your key after the equals sign:

```bash
GEMINI_API_KEY=your_key_here
```

Use your own key — never paste a real one into this README or anywhere else that gets committed. `.env` is already in `.gitignore`, so it stays on your machine.

Restart the server after any change to `.env`.

### Step 3. Start the app

```bash
npm run dev
```

### Step 4. Open it and create the wallet

Open [http://localhost:3000](http://localhost:3000). The Setup panel on the left walks you through it. Click **Create wallet** to give the agent an escrow wallet, or set `WALLET_PRIVATE_KEY` in `.env` to use one you already have. Use **test wallets only**.

### Step 5. Try it

Try asking the agent *"Show me the tickets"*, then *"Is OV-1006 safe to buy?"*, then *"check OV-9999"* to see the not-found path.

### Optional environment variables

| Variable | Used for |
| :--- | :--- |
| `GEMINI_API_KEY` | **Required.** Your Gemini API key. |
| `GEMINI_MODEL` | Optional. Sets the default Gemini model on startup; only used if it names a model on the allowlist (see [Supported AI models](#supported-ai-models)). Otherwise the default is `gemini-flash-lite-latest`. |
| `WALLET_PRIVATE_KEY` | Optional. Use an existing agent wallet instead of the Create wallet button. The escrow uses it. |
| `SCANNER_PRIVATE_KEY` | For escrow. The demo scanner key. Without it the "Scan at gate" button cannot send the check-in. |
| `BASE_SEPOLIA_RPC_URL` | Optional. Override the escrow RPC. Defaults to the public `https://sepolia.base.org`. |

Use **test wallets only** for `WALLET_PRIVATE_KEY` and `SCANNER_PRIVATE_KEY`. Never put a wallet with real money here.

### Deploying to Vercel

- Set the variables above in the Vercel project's environment variables. The Create wallet button writes to disk, which is read-only on Vercel, so use `WALLET_PRIVATE_KEY` (and `SCANNER_PRIVATE_KEY`) there.
- The escrow routes (`/api/escrow/fund`, `/api/escrow/scan`, `/api/escrow/refund`) wait for one or two transaction receipts, so they are the slow calls. They set `maxDuration = 60` (seconds). On Vercel's Hobby plan functions are capped at 10 seconds, so **funding may time out there** — raise the limit on a paid plan or point `BASE_SEPOLIA_RPC_URL` at a faster RPC. The read-only routes (`/api/escrow/deal`, `/api/escrow/status`, `/api/escrow/open-deals`) return immediately.
- Reads can be slightly stale on the load-balanced public RPC right after a write; the app polls reads until they match the expected on-chain result, and waits for the allowance to be visible before funding.

## Testing

Unit tests run on Node's built-in test runner — no extra packages, no network, no API keys and no blockchain calls.

```bash
npm test          # risk rules, escrow policy/guards, model allowlist, activity log
npx tsc --noEmit  # typecheck
npm run build     # production build

cd escrow
npm test          # OveloEscrow contract tests (local in-memory chain)
```

**What the tests cover**

- `assessTicketRisk` for all six demo tickets — level and score (OV-1001 LOW 0, OV-1002 HIGH 100, OV-1003 HIGH 140, OV-1004 HIGH 70, OV-1005 HIGH 80, OV-1006 MEDIUM 65), non-empty reasons, and the recommendation text matching the level.
- `findDemoTicket` / `isKnownTicket`: case- and space-tolerant lookups, and unknown or malformed ids returning nothing instead of throwing.
- Funding policy (`evaluateFundingPolicy`): HIGH always refused, MEDIUM refused unless approved, LOW allowed; unknown tickets refused.
- Deterministic ids: `runIdFor` is stable inside one 10-minute funding window and changes across windows or tickets; `ticketKeyFor` is a deterministic 32-byte hash.
- The deal amount is always exactly 1 test USDC, the guard thresholds (cooldown `20s`, ETH floor, `3 USDC` floor, `40` deal cap) and `DEAL_STATUS`.
- The model allowlist (`agent/models.ts`): allowed ids pass, unknown ids are rejected, and the default (`gemini-flash-lite-latest`) is used when none is given.
- The activity log (`lib/activity.ts`): tool steps become the right plain-English events.

**What the tests do not cover**

- Anything that needs the network or a key: `runAgent` and the Gemini calls, the x402 `payAndFetch` / `verifyPayment` flow, and every escrow function that reads the chain or sends a transaction (`fundEscrow`, `scanAtGate`, `refundDeal`, `getEscrowStatus`, `listOpenDeals`). The guard comparisons in `fundEscrow` (cooldown, balance floor, deal cap) run next to those chain reads, so only their threshold constants are asserted here.
- The React UI and the API routes.
- `escrow/` is covered separately by the Hardhat contract tests.

CI runs all of this on every push and pull request to `main`: see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## How a deal works (the three endings)

The escrow is **real**, and runs on the Base Sepolia **test network** with **test money** only.

- **Contract:** [`OveloEscrow`](escrow/contracts/OveloEscrow.sol) at `0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E` (chain id 84532).
- **Token:** test USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals).
- **Scanner:** the contract only lets one trusted address call `checkIn` — the demo scanner.
- **Seller:** every demo deal pays the same demo seller `0x3c86C6a22564E1515E4628426a3ca6a03C28c04d`.

The flow:

1. On the **Check** tab, Ovelo checks a ticket and shows the rule-based risk level.
2. **LOW** → a **Fund escrow** button (the agent may also call `fund_escrow` from the chat). **MEDIUM** → an **Approve and fund escrow** button, because a person must approve. **HIGH** → blocked, with the reasons and no button.
3. Funding does two real transactions: `approve` (1 test USDC) then `fund`. The money is now held by the contract, not the seller.
4. Press **Scan at gate (demo scanner)** to call `checkIn` from the scanner wallet. The contract verifies the caller is the trusted scanner, marks the deal **Released**, and pays the seller exactly 1 test USDC.
5. Press **Scan again** to see the contract reject a second scan — Ovelo *simulates* first, so no transaction is sent and the contract's own reason is shown in plain words.
6. If you never scan, the money is not lost.

A funded deal ends in exactly one of three ways:

| Ending | Trigger | On-chain result |
| --- | --- | --- |
| **Released** | The trusted scanner calls `checkIn` before the deadline. | The 1 test USDC is paid to the seller. |
| **Refunded** | The buyer calls `refund` after the deadline passed without a scan. | The 1 test USDC is returned to the buyer (the agent wallet). |
| **Still open** | Nobody has scanned and the deadline has not passed yet. | The 1 test USDC stays locked in the contract. |

The **Refund** button only appears once a deal is expired, and the server re-checks every rule (Funded, agent is the buyer, deadline passed) before sending anything. You can also run the recovery script from `escrow/` to refund every stuck deal at once:

```bash
cd escrow
npm run refund:baseSepolia
```

It prints the deal table, refunds only the qualifying deals, and writes a public record to `escrow/deployments/refund-baseSepolia.json`.

## Safety guards (server-side)

The server recomputes the risk itself — it never trusts the browser or the AI — and refuses to spend if any of these fail:

- The agent's ETH is below `0.0003` ETH (gas), or its test USDC is below `3 USDC`.
- The contract has already opened `40` deals (the demo cap).
- A new deal is requested less than `20` seconds after the previous one (a global cooldown, on both the button and the agent's `fund_escrow`).
- The amount is always exactly `1` test USDC, and only the known contract and token are ever called.
- Only three on-chain actions exist: `fund` (approve + fund), `checkIn` and `refund`.

Keys (`WALLET_PRIVATE_KEY`, `SCANNER_PRIVATE_KEY`) are used only inside `agent/escrow.ts` on the server. They are never logged, returned to the browser, or included in an API response.

## Trust model

Ovelo is a demo, but the parts that hold or move test money are real code and a real contract. This is what each protection actually does — and, just as important, what it does **not**.

### Attack or mistake → what Ovelo does

| Attack or mistake | What Ovelo does |
| :--- | :--- |
| The browser asks to fund a **HIGH**-risk ticket (or claims it is LOW) | The server ignores the browser: it recomputes the risk itself and refuses **HIGH** every time. |
| The model tries to fund a **MEDIUM** ticket on its own | The agent tool always sends `approved: false`, so **MEDIUM** is refused until a person presses **Approve and fund escrow**. |
| The model calls `fund_escrow` twice for the same ticket | The agent path uses a deterministic run id, so both calls map to the same on-chain ticket; the contract refuses a second deal while one is open. |
| Someone sends an arbitrary model name from the browser | The server only accepts model ids on its allowlist and rejects anything else. |
| The scanner tries to check in a second time | The contract rejects the second check-in. Ovelo simulates it first, so no transaction is even sent. |
| The scanner tries to check in after the deadline | The contract rejects any check-in after the deal's deadline. |
| Someone other than the buyer tries to refund | The contract only lets the buyer refund, only while the deal is Funded, and only after the deadline. |
| The agent wallet is nearly empty | The server refuses to spend below its ETH gas floor or its 3 USDC floor. |
| The demo is asked to open too many deals | The server refuses after the cap of 40 deals. |
| Two new deals are opened back to back | A global 20-second cooldown applies to both the button and the agent's tool. |
| A key leaking into a response | The keys live server-side only (a server environment variable, or the server-side wallet file created by the **Create wallet** button) and are never returned in any API response. |

### What a result means

A **LOW** result means only that the fixed rules found nothing wrong on the demo data. It is **not** a guarantee that any real ticket is safe, and it says nothing about a real seller, issuer or event.

### What Ovelo does NOT protect against

- **A dishonest demo scanner.** The gate check-in is trusted: whoever holds the demo scanner key could release the funds. There is no independent check that a real ticket was shown.
- **One shared public demo wallet.** The agent/buyer wallet is a single shared demo wallet, not a wallet per user.
- **x402 payments are signed but not settled on-chain yet (planned).** The weather and ticket-report demos only sign and verify a payment message; no x402 payment is submitted on-chain.
- **The contract is not audited and not yet verified on Basescan (planned).** The source is not published on the explorer yet.
- **Demo tickets only.** Ovelo knows only six made-up tickets and cannot check a real ticket, seller or event company.
- **A lagging public RPC.** Answers rely on a public Base Sepolia RPC that can return stale reads; the app polls reads to reduce this, but a value can still be a moment behind.

See the [on-chain proof](docs/PROOF.md) for the real testnet transactions, [`SECURITY.md`](SECURITY.md) for how to report a problem and the test-wallet warning, and [`CHANGELOG.md`](CHANGELOG.md) for what is built and what is only planned.

## Honest limits

1. **It only works on fake tickets.** The six demo tickets are made up. Ovelo has no connection to any real ticketing system.
2. **It cannot verify real tickets or real companies.** It cannot look up a real event, check a real barcode, confirm a real issuer, or find out whether a real seller has been caught scamming before.
3. **The escrow is testnet-only with a trusted demo scanner.** It runs on Base Sepolia with test money, one shared demo agent wallet, and a scanner we control. The check-in is a button, not a real venue scan. The contract is unaudited and not meant for real funds. Amounts are scaled down: a deal is always 1 test USDC, not the ticket's real price.
4. **The x402 payments are signed but not sent on-chain.** The weather and ticket-report demos sign a payment message with the agent's wallet and the API verifies the signature, but no transaction is submitted for those. (The escrow, by contrast, does send real testnet transactions.)
5. **The written explanation is still written by the AI.** The level, score and reasons all come from code, but the wording around them comes from Gemini. The UI renders the risk fields directly rather than trusting the prose.

Don't use Ovelo to make a real purchase decision.
