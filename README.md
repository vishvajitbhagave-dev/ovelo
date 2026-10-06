# agentmaxxin

A minimal Next.js template for building AI agents that call tools and pay for services with their own crypto wallet. The agent is powered by Google Gemini.

The template is intentionally small. You will spend almost all of your time in a single file, `agent/tools.ts`, where each tool is a plain TypeScript function that the agent can decide to call.

## What You Get

1. A working agent loop that sends your message to Gemini, runs any tools Gemini asks for, and returns the final answer.
2. A tools file where you add, remove, or change the functions your agent can use.
3. An agent wallet that can sign payments, based on the x402 payment pattern.
4. A mock paid weather API that refuses requests until the agent pays for them.
5. A single page interface with guided setup, a one click wallet button, and a chat that shows every tool call and payment.

## Prerequisites

1. Node.js version 20 or newer. Check with `node -v`.
2. A free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey).

## Getting Started

### Step 1. Create your project

Run the following command in your terminal. Replace `my-agent` with any folder name you like.

```bash
npx agentmaxxin my-agent
```

This copies the template into a new folder, creates a `.env` file for you, and installs all packages.

### Step 2. Move into the project folder

```bash
cd my-agent
```

### Step 3. Add your Gemini API key

Open the `.env` file in the project root and paste your key after the equals sign:

```bash
GEMINI_API_KEY=your_key_here
```

Save the file. The key stays on your machine and is never committed to git.

### Step 4. Start the app

```bash
npm run dev
```

### Step 5. Create the agent wallet

Open [http://localhost:3000](http://localhost:3000) in your browser. The Setup panel on the left walks you through everything.

Click **Create wallet**. The agent now has its own wallet, which it uses to sign payments for paid APIs. The wallet is saved in `.agent-wallet.json` in your project folder, so it stays the same after a restart.

### Step 6. Talk to your agent

Try one of these prompts:

1. `What's the weather in Mumbai?` The agent calls the paid weather API and pays for it with its wallet.
2. `What's in your wallet?` The agent reads its own wallet address and balance.
3. `Roll a 20 sided dice` The agent calls a simple tool with no wallet involved.

Click any tool entry above a reply to see exactly what the agent sent and received. The agent remembers the conversation, so you can ask follow up questions. Use **Clear** to start over.

### Step 7. Build your own tool

Open `agent/tools.ts` and add a new object to the `tools` list. For example:

```ts
{
  name: "get_joke",
  description: "Get a random joke.",
  parameters: { type: "object", properties: {} },
  run: async () => {
    const res = await fetch("https://official-joke-api.appspot.com/random_joke");
    return res.json();
  },
},
```

Save the file and refresh the page. Your new tool appears in the Tools panel. Now ask your agent to tell you a joke.

## Writing Good Tools

Every tool has four parts.

| Field | Purpose |
| :--- | :--- |
| `name` | A unique identifier in snake case, such as `get_weather`. |
| `description` | Plain English explaining what the tool does. Gemini reads this to decide when to use it, so be clear and specific. |
| `parameters` | A JSON Schema describing the inputs. Gemini fills in these values for you. |
| `run` | The function that does the work. Whatever it returns is sent back to Gemini. |

A few guidelines:

1. Return plain objects, for example `{ temperature: 28 }`, rather than strings or class instances.
2. Keep each tool focused on one job. Several small tools work better than one large tool.
3. If something can fail, let it throw. The agent loop catches the error and reports it back to Gemini, which can then explain the problem or try again.

## How It Works

### The agent loop

The loop lives in `agent/agent.ts`.

1. Your message and the list of tools are sent to Gemini.
2. If Gemini replies with a tool call, the matching `run` function is executed and its result is sent back to Gemini.
3. This repeats until Gemini replies with plain text, which becomes the final answer.
4. The loop stops after five rounds to prevent runaway tool calls.

### Paying for an API

The weather tool demonstrates the x402 pattern, where an agent pays for an API one request at a time.

1. The agent requests `/api/weather`.
2. The API responds with status `402 Payment Required` along with a price, an asset, and a recipient address.
3. The agent wallet signs a payment message for that amount.
4. The agent repeats the request with the signed payment in an `X-PAYMENT` header.
5. The API verifies the signature and responds with status `200 OK` and the weather data.

All of this is handled by the `payAndFetch` helper in `agent/wallet.ts`. Any tool that calls a paid API can use the same helper.

Payments in this template are cryptographically signed but are not submitted to a blockchain, so no real funds are ever moved.

## Project Structure

| Path | Description |
| :--- | :--- |
| `agent/tools.ts` | The tools your agent can use. This is the file you will edit most. |
| `agent/agent.ts` | The agent loop that communicates with Gemini. |
| `agent/wallet.ts` | The agent wallet, payment signing, and payment verification. |
| `app/page.tsx` | The page: setup steps, tools list, and chat. |
| `app/api/agent/route.ts` | The server endpoint that runs the agent. |
| `app/api/wallet/route.ts` | The server endpoint that creates and reads the agent wallet. |
| `app/api/weather/route.ts` | The mock paid weather API. |
| `components/ui/` | Interface components from [shadcn/ui](https://ui.shadcn.com). You do not need to edit these. |
| `.env` | Your API key and optional settings. |
| `.agent-wallet.json` | The agent wallet, created when you click Create wallet. Never share this file. |

## Configuration

All settings live in the `.env` file.

| Variable | Required | Description |
| :--- | :--- | :--- |
| `GEMINI_API_KEY` | Yes | Your Gemini API key. |
| `GEMINI_MODEL` | No | The Gemini model to use. Defaults to `gemini-flash-latest`. |
| `WALLET_PRIVATE_KEY` | No | Use an existing wallet instead of the Create wallet button. A private key starting with `0x`. When set, it takes priority over `.agent-wallet.json`. |

Restart `npm run dev` after changing any value in `.env`.

## The Agent Wallet

Clicking **Create wallet** generates a new private key and saves it to `.agent-wallet.json`. The file is listed in `.gitignore`, so it is never committed.

Once the wallet exists, the Setup panel shows:

1. The wallet address, with a button to copy it.
2. The current ETH balance on Base Sepolia, with a refresh button.
3. A link to view the wallet on the Base Sepolia block explorer.
4. A link to faucets where you can request free test ETH.

To start again with a new wallet, stop the server, delete `.agent-wallet.json`, restart, and click **Create wallet** again.

To use a wallet you already have, set `WALLET_PRIVATE_KEY` in `.env` instead.

> **Security note:** Only ever use this wallet for testing. Never send real funds to it. Private keys in `.agent-wallet.json` and `.env` are stored as plain text.

## Troubleshooting

| Problem | Solution |
| :--- | :--- |
| The page says to add `GEMINI_API_KEY` | Add your key to `.env` and restart `npm run dev`. |
| The agent never uses my new tool | Make the `description` more specific about when the tool should be used, then restart the server. |
| The weather tool fails with "no wallet yet" | Click **Create wallet** in the Setup panel, then ask again. |
| Port 3000 is already in use | Run `npm run dev -- -p 3001` and open that port instead. |
| A model error appears in the chat | Check that your API key is valid, or set a different model in `GEMINI_MODEL`. |

## Tech Stack

1. [Next.js](https://nextjs.org) for the app and API routes.
2. [shadcn/ui](https://ui.shadcn.com) and [Tailwind CSS](https://tailwindcss.com) for the interface.
3. [Google Gen AI SDK](https://www.npmjs.com/package/@google/genai) for Gemini function calling.
4. [viem](https://viem.sh) for wallet creation, message signing, and reading Base Sepolia.

## License

MIT
