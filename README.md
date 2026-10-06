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

### Planned — not built yet

Nothing below exists in the code today. It's here so you know where the project is headed.

| Planned | What it would mean |
| :--- | :--- |
| **Paid ticket-history report using x402** | A buyer pays a small amount per check, using the same sign-a-payment pattern the weather demo already uses. |
| **Escrow payment on Base Sepolia** | Hold the buyer's money in escrow and release it to the seller once the ticket passes the gate, instead of paying the seller up front. |
| **Demo gate scanner** | A page that "scans" a ticket barcode, flips `alreadyScanned` to true, and shows what Ovelo says before and after. |
| **A designed UI** | Replace the starter kit's generic chat page with a purpose-built ticket-review screen showing the level, the score, and each reason. |

## Honest limits

1. **It only works on fake tickets.** The six demo tickets are made up. Ovelo has no connection to any real ticketing system.
2. **It cannot verify real tickets or real companies.** It cannot look up a real event, check a real barcode, confirm a real issuer, or find out whether a real seller has been caught scamming before.
3. **The starter kit's payments are signed but not sent on-chain.** The weather demo signs a payment message with the agent's wallet and the API verifies the signature, but no transaction is ever submitted and no real funds move. It's a working demonstration of the pattern, not a real payment.
4. **The written explanation is still written by the AI.** The level, score and reasons all come from code, but the wording around them comes from Gemini. If you need the wording guaranteed to match the score, the UI should render those fields directly rather than trusting the prose.

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
| `WALLET_PRIVATE_KEY` | No | Use a wallet you already have instead of the Create wallet button. |

## Tech stack

| Tool | Used for |
| :--- | :--- |
| [Next.js](https://nextjs.org) | The app and its API routes. |
| [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai) | Gemini, including function calling. |
| [viem](https://viem.sh) | Wallet creation, message signing, and reading Base Sepolia. |
| x402 payment pattern | The sign-a-payment-to-unlock-an-API flow, demoed by the paid weather tool. |
| Base Sepolia testnet | The test network the wallet points at. |

## Credits

Built on the **Agentmaxxing starter kit**, which supplied the agent loop, the tool system, the wallet, and the paid weather demo. Ovelo adds the ticket data, the risk rules, and the two tools on top.

## License

MIT