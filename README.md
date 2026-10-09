# Ovelo

An AI agent that helps resale-ticket buyers decide whether a deal looks safe.

> **This is a demo with fake data.** Ovelo cannot check real tickets, real sellers, or real event companies. Everything it knows about comes from six made-up demo tickets. See [Honest limits](#honest-limits).

## The problem

Buying a resale ticket online is a bit of a gamble. Common ways people get burned:

1. **Copied tickets.** Someone photographs a real ticket and sells the same seat twice. The second buyer turns up at the gate and gets nothing.
2. **Already-used tickets.** The ticket was already scanned at the door once, and the seller tries to sell it again.
3. **Fake sellers.** The seller isn't the person the ticket is registered to, the price is wildly over the official resale cap, or the ticket comes from an issuer nobody has ever heard of.

The signs are usually visible somewhere in the listing. The problem is that most buyers don't know which signs matter.

## How it works

The important idea: **the risk level comes from fixed rules in code, not from the AI.**

The AI is not asked to judge whether a ticket is safe. That job belongs to a plain TypeScript function in [`agent/tickets.ts`](agent/tickets.ts), which adds up points and then buckets the total. This means the same ticket always gets the same answer, and you can read the rules to know exactly why.

### The rules and their scores

| Rule | Score |
| :--- | ---: |
| Ticket has already been scanned at the gate | +100 |
| Seller is not the current owner of the ticket | +100 |
| Ticket issuer is not verified | +80 |
| Asking price is more than **2×** the resale cap | +70 |
| Asking price is above the resale cap, up to 2× | +40 |
| Ticket changed hands less than 10 minutes ago | +25 |

The price rules are mutually exclusive — a ticket gets either +70 or +40, never both. Rules can stack, so one ticket can pick up several at once.

### How a score becomes a level

| Total score | Risk level | Recommendation |
| :--- | :--- | :--- |
| 70 or more | **HIGH** | do not fund |
| 25 to 69 | **MEDIUM** | ask the buyer to approve first |
| Under 25 | **LOW** | ok to proceed |

### What the AI actually does

Once the code has produced a level, a score, and a list of reasons, Gemini turns it into a normal, friendly explanation. That's it. Its system prompt tells it to base every answer only on the tool's output, to always say *why*, and to never invent or soften a risk level.

So: **code decides, AI explains.** If you want to change how a ticket is judged, you edit a number in `agent/tickets.ts` — you don't touch the model.

### The tools

| Tool | What it does |
| :--- | :--- |
| `list_demo_tickets` | Lists the six demo tickets with their id, seat and asking price. |
| `check_ticket_risk` | Runs the rules against one ticket id and returns the level, score, reasons and recommendation. |
| `get_ticket_history_report` | Buys the paid (signed, not on-chain) history report for one ticket. |
| `fund_escrow` | Funds a **real** Base Sepolia escrow for one ticket — allowed for **LOW** risk only. |
| `get_weather` | The starter kit's paid weather demo. |
| `get_my_wallet` | Returns the agent wallet address and its Base Sepolia ETH balance. |
| `roll_dice` | Rolls a dice. |

If you ask about a ticket id that doesn't exist, the tool says so and lists the valid ids instead of failing.

## The demo tickets

Six fake tickets for the fictional event **Demo Music Night 2026**.

| Ticket | Seat | Asking price | What stands out | Risk |
| :--- | :--- | ---: | :--- | :--- |
| **OV-1001** | Floor A · Row 4 · Seat 12 | $165 | Owner is selling, issuer verified, under the $180 cap | **LOW** (0) |
| **OV-1002** | Balcony B · Row 11 · Seat 6 | $175 | Already scanned at the gate | **HIGH** (100) |
| **OV-1003** | Floor A · Row 7 · Seat 3 | $190 | Seller isn't the owner, and it's $10 over the $180 cap | **HIGH** (140) |
| **OV-1004** | Floor C · Row 2 · Seat 21 | $480 | More than twice the $200 cap | **HIGH** (70) |
| **OV-1005** | Floor B · Row 9 · Seat 15 | $170 | Issuer is not verified | **HIGH** (80) |
| **OV-1006** | Balcony A · Row 3 · Seat 8 | $230 | Changed hands 2 minutes ago, and it's $30 over the $200 cap | **MEDIUM** (65) |

OV-1003 picks up two rules at once, which is why its score (140) is higher than its headline problem. That's intentional — it's the clearest example of several warning signs stacking up.

Try asking the agent *"Show me the tickets"*, then *"Is OV-1006 safe to buy?"*, then *"check OV-9999"* to see the not-found path.

## What is built vs what is planned

### Built today

1. Six demo tickets and a rule-based risk engine in `agent/tickets.ts`.
2. The `list_demo_tickets` and `check_ticket_risk` tools.
3. A system prompt that keeps the AI as an explainer and keeps it honest about the demo.
4. The starter kit's chat, the Tools panel, the Setup panel, and the agent wallet — all still working.
5. The starter kit's `get_weather` (a paid demo API), `get_my_wallet`, and `roll_dice` tools.
6. The paid ticket-history report (x402 pattern: signed, not sent on-chain).
7. A designed UI with **Tickets / Check / Agent wallet** tabs (see `components/`).
8. A **real on-chain escrow** on Base Sepolia, with a demo gate scanner (see below).

### Planned — not built yet

Nothing below exists in the code today. It's here so you know where the project is headed.

| Planned | What it would mean |
| :--- | :--- |
| **Real gate integration** | Replace the "demo scanner" button with a real venue scan that flips the ticket's status. |
| **Real (JSON-RPC / wallet) x402 settlement** | Move the signed-only payments onto a settlement layer instead of just verifying the signature. |
| **Multi-ticket checkout** | Fund and track more than one ticket at a time. |

## On-chain escrow on Base Sepolia

This part is **real**: it signs and sends transactions on the Base Sepolia **test network**, using **test money** only.

- **Contract:** [`OveloEscrow`](escrow/contracts/OveloEscrow.sol) at [`0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E`](https://sepolia.basescan.org/address/0xAAa0c9d296EfA3Df324d26D0757608cEB408bE8E) (chain id 84532).
- **Token:** test USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (6 decimals).
- **Scanner:** the contract only lets one trusted address call `checkIn` — the demo scanner.
- **Seller:** every demo deal pays the same demo seller `0x3c86C6a22564E1515E4628426a3ca6a03C28c04d`.

### How the demo works

1. On the **Check** tab, Ovelo checks a ticket and shows the rule-based risk level.
2. **LOW** → a **Fund escrow** button (the agent may also call `fund_escrow` from the chat). **MEDIUM** → an **Approve and fund escrow** button, because a person must approve. **HIGH** → blocked, with the reasons and no button.
3. Funding does two real transactions: `approve` (1 test USDC) then `fund`. The money is now held by the contract, not the seller.
4. Press **Scan at gate (demo scanner)** to call `checkIn` from the scanner wallet. The contract verifies the caller is the trusted scanner, marks the deal **Released**, and pays the seller exactly 1 test USDC.
5. Press **Scan again** to see the contract reject a second scan — Ovelo *simulates* first, so no transaction is sent and the contract's own reason is shown in plain words.
6. If you never scan, the money is not lost: once the deal's one-hour deadline passes, the **Agent wallet** tab shows it under **Open deals** with a **Refund** button, and the buyer can call `refund` to get the 1 test USDC back.

Every run uses a fresh, random `runId`; the on-chain ticket id is `keccak256("<ticketId>:<runId>")`. That keeps the same demo ticket reusable while the contract's "no double sale" protection still applies within a run. The app reads the contract and the token directly (no Hardhat artifacts needed on the host); the public addresses live in [`agent/escrow-config.ts`](agent/escrow-config.ts) and the server-only logic in [`agent/escrow.ts`](agent/escrow.ts).

### The three endings

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

### Safety guards (server-side)

The server recomputes the risk itself — it never trusts the browser or the AI — and refuses to spend if any of these fail:

- The agent's ETH is below `0.0003` ETH (gas), or its test USDC is below `3 USDC`.
- The contract has already opened `15` deals (the demo cap).
- The amount is always exactly `1` test USDC, and only the known contract and token are ever called.
- Only three on-chain actions exist: `fund` (approve + fund), `checkIn` and `refund`.

Keys (`WALLET_PRIVATE_KEY`, `SCANNER_PRIVATE_KEY`) are used only inside `agent/escrow.ts` on the server. They are never logged, returned to the browser, or included in an API response.

## Honest limits

1. **It only works on fake tickets.** The six demo tickets are made up. Ovelo has no connection to any real ticketing system.
2. **It cannot verify real tickets or real companies.** It cannot look up a real event, check a real barcode, confirm a real issuer, or find out whether a real seller has been caught scamming before.
3. **The escrow is testnet-only with a trusted demo scanner.** It runs on Base Sepolia with test money, one shared demo agent wallet, and a scanner we control. The check-in is a button, not a real venue scan. The contract is unaudited and not meant for real funds. Amounts are scaled down: a deal is always 1 test USDC, not the ticket's real price.
4. **The starter kit's x402 payments are signed but not sent on-chain.** The weather and ticket-report demos sign a payment message with the agent's wallet and the API verifies the signature, but no transaction is submitted for those. (The escrow, by contrast, does send real testnet transactions.)
5. **The written explanation is still written by the AI.** The level, score and reasons all come from code, but the wording around them comes from Gemini. The UI renders the risk fields directly rather than trusting the prose.

Don't use Ovelo to make a real purchase decision.

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

Open [http://localhost:3000](http://localhost:3000). The Setup panel on the left walks you through it. Click **Create wallet**.

The agent now has its own wallet, which it uses to sign payments for the paid weather demo. It's saved to `.agent-wallet.json`, so it survives restarts.

### Step 5. Ask it something

Try:

1. `Show me the demo tickets` — lists all six.
2. `Is OV-1003 safe to buy?` — runs the rules and explains why.
3. `Is OV-1004 safe to buy?` — a HIGH result. The agent should say do not fund.

Click any tool entry above a reply to see exactly what went in and came out. The agent remembers the conversation, so follow-up questions work. Use **Clear** to start over.

### Optional settings

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Yes | Your Gemini API key. |
| `GEMINI_MODEL` | No | Which Gemini model to use. Defaults to `gemini-flash-latest`. |
| `WALLET_PRIVATE_KEY` | No | Use a wallet you already have instead of the Create wallet button. The escrow uses this. |
| `SCANNER_PRIVATE_KEY` | For escrow | The demo scanner key. Without it the "Scan at gate" button cannot send the check-in. |
| `BASE_SEPOLIA_RPC_URL` | No | Override the escrow RPC. Defaults to the public `https://sepolia.base.org`. |

Use **test wallets only** for `WALLET_PRIVATE_KEY` and `SCANNER_PRIVATE_KEY`. Never put a wallet with real money here.

### Deploying to Vercel

- Set the variables above in the Vercel project's environment variables. The Create wallet button writes to disk, which is read-only on Vercel, so use `WALLET_PRIVATE_KEY` (and `SCANNER_PRIVATE_KEY`) there.
- The escrow routes (`/api/escrow/fund`, `/api/escrow/scan`, `/api/escrow/refund`) wait for one or two transaction receipts, so they are the slow calls. They set `maxDuration = 60` (seconds). On Vercel's Hobby plan functions are capped at 10 seconds, so **funding may time out there** — raise the limit on a paid plan or point `BASE_SEPOLIA_RPC_URL` at a faster RPC. The read-only routes (`/api/escrow/deal`, `/api/escrow/status`, `/api/escrow/open-deals`) return immediately.
- Reads can be slightly stale on the load-balanced public RPC right after a write; the app polls reads until they match the expected on-chain result.


## Tech stack

| Tool | Used for |
| :--- | :--- |
| [Next.js](https://nextjs.org) | The app and its API routes. |
| [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai) | Gemini, including function calling. |
| [viem](https://viem.sh) | Wallet creation, message signing, and reading Base Sepolia. |
| x402 payment pattern | The sign-a-payment-to-unlock-an-API flow, demoed by the paid weather tool. |
| Base Sepolia testnet | The test network the wallet points at, and the network the escrow contract runs on. |

## Credits

Built on the **Agentmaxxing starter kit**, which supplied the agent loop, the tool system, the wallet, and the paid weather demo. Ovelo adds the ticket data, the risk rules, and the two tools on top.

## License

MIT