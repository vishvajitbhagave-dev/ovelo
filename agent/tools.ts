/**
 * YOUR AGENT'S TOOLS
 *
 * A tool is just a function the agent is allowed to call.
 * Gemini reads the `description` to decide WHEN to use it,
 * and `parameters` to know WHAT to pass in.
 *
 * Add your own tool: copy one of the objects below, change it,
 * and save. It shows up in the "Tools" list on the page.
 */
import { getWalletAddress, getWalletBalance, payAndFetch } from "./wallet";
import { DEMO_EVENT, DEMO_TICKETS, DEMO_TICKET_IDS, assessTicketRisk, findDemoTicket } from "./tickets";

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema describing the inputs. */
  parameters: object;
  /** The code that runs when the agent calls this tool. */
  run: (args: any, ctx: { baseUrl: string }) => Promise<unknown>;
};

export const tools: Tool[] = [
  // ─── 1. A paid API: the agent's wallet signs a payment to unlock it ───
  {
    name: "get_weather",
    description: "Get the current weather for a city. Costs 0.01 USDC, paid automatically from the agent's wallet.",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name, e.g. Mumbai" },
      },
      required: ["city"],
    },
    run: async ({ city }, { baseUrl }) => {
      return payAndFetch(`${baseUrl}/api/weather?city=${encodeURIComponent(city)}`);
    },
  },

  // ─── 2. Wallet tool: read the agent's own wallet ───
  {
    name: "get_my_wallet",
    description: "Get the agent's own wallet address and its ETH balance on Base Sepolia (testnet).",
    parameters: { type: "object", properties: {} },
    run: async () => ({
      address: getWalletAddress(),
      balance: await getWalletBalance(),
      network: "Base Sepolia (testnet)",
    }),
  },

  // ─── 3. A plain tool: no wallet, no API. Try changing this one first! ───
  {
    name: "roll_dice",
    description: "Roll a dice with the given number of sides.",
    parameters: {
      type: "object",
      properties: {
        sides: { type: "number", description: "How many sides the dice has. Default 6." },
      },
    },
    run: async ({ sides = 6 }) => ({ rolled: Math.floor(Math.random() * sides) + 1, sides }),
  },

  // ─── 4. Ovelo: list the fake demo tickets ───
  {
    name: "list_demo_tickets",
    description:
      "List the demo tickets available, with each ticket's id, event, seat and asking price. " +
      "Use this first when someone asks what tickets are available, so you know the valid ids. " +
      "DEMO ONLY: these are fake tickets and they cannot verify anything real.",
    parameters: { type: "object", properties: {} },
    run: async () => ({
      event: DEMO_EVENT,
      demoOnly: true,
      count: DEMO_TICKETS.length,
      tickets: DEMO_TICKETS.map((t) => ({
        id: t.id,
        event: t.event,
        seat: t.seat,
        askingPriceUsd: t.askingPriceUsd,
      })),
    }),
  },

  // ─── 5. Ovelo: check one fake ticket's risk (rules live in agent/tickets.ts) ───
  {
    name: "check_ticket_risk",
    description:
      "Check the resale risk of ONE demo ticket and get back a risk level (LOW, MEDIUM or HIGH), " +
      "a score, plain-English reasons and a recommendation. " +
      "You must call this before saying anything about whether a ticket is safe. " +
      "DEMO ONLY: these are fake tickets and they cannot verify anything real.",
    parameters: {
      type: "object",
      properties: {
        ticketId: { type: "string", description: "The demo ticket id, e.g. OV-1001" },
      },
      required: ["ticketId"],
    },
    run: async ({ ticketId }) => {
      const ticket = findDemoTicket(String(ticketId ?? ""));
      if (!ticket) {
        return {
          found: false,
          error: `There is no demo ticket with id "${String(ticketId ?? "")}".`,
          validTicketIds: DEMO_TICKET_IDS,
        };
      }
      return { found: true, demoOnly: true, ...assessTicketRisk(ticket) };
    },
  },
];
