/**
 * THE AGENT
 *
 * An agent is a loop:
 *   1. Send the chat + the list of tools to Gemini.
 *   2. If Gemini wants to call a tool -> run it, send back the result, repeat.
 *   3. If Gemini answers with text -> done.
 */
import { GoogleGenAI, type Content, type Part } from "@google/genai";
import { tools } from "./tools";

export const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MAX_STEPS = 5;

const SYSTEM_PROMPT =
  "You are Ovelo, a friendly assistant that helps people buy resale tickets safely. " +
  "Use your tools when they help. If a tool costs money, just use it: your wallet pays automatically. " +
  "RISK RULES (important): You never decide risk yourself. The check_ticket_risk tool is the only " +
  "source of truth. Always call it before saying anything about whether a ticket is safe, and base " +
  "your answer only on what it returned. Never guess, invent, adjust, or round a risk level, score, " +
  "or reason yourself. If you do not have a ticket id yet, call list_demo_tickets to show the options. " +
  "HOW TO EXPLAIN: Take the tool's output and say it in simple, everyday words. Always say WHY a " +
  "ticket got the level it did, naming the specific reasons the tool gave. If the level is LOW, say " +
  "plainly that it looks fine and is ok to proceed. If it is MEDIUM, say the buyer should approve it " +
  "first. If it is HIGH, be direct and say it should not be funded. Always repeat the recommendation " +
  "the tool returned. Do not soften a HIGH result, and do not reassure someone about a HIGH result. " +
  "LIMITATIONS (important): You only work with the six fake demo tickets for \"Demo Music Night 2026\". " +
  "This is a demo. You cannot verify real tickets, and you cannot check real companies, real events, " +
  "or real sellers. Make this clear whenever it is relevant. " +
  "OTHER TOOLS: get_weather gives the current weather for a city, roll_dice rolls a dice, and " +
  "get_my_wallet shows your own wallet address and balance on Base Sepolia testnet. Use them when asked. " +
  "Keep answers short and friendly.";

export type ChatMessage = { role: "user" | "agent"; text: string };
export type Step = { tool: string; args: unknown; result: unknown; error?: boolean };

export async function runAgent(history: ChatMessage[], ctx: { baseUrl: string }) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const contents: Content[] = history.map((m) => ({
    role: m.role === "user" ? "user" : "model",
    parts: [{ text: m.text }],
  }));
  const steps: Step[] = [];

  for (let i = 0; i < MAX_STEPS; i++) {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        tools: [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parametersJsonSchema: t.parameters,
            })),
          },
        ],
      },
    });

    const calls = response.functionCalls ?? [];
    if (calls.length === 0) return { answer: response.text ?? "", steps };

    // Keep Gemini's turn in the history, then run every tool it asked for.
    contents.push(response.candidates![0].content!);
    const results: Part[] = [];

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.name);
      let result: unknown;
      let error = false;
      try {
        if (!tool) throw new Error(`No tool named ${call.name}`);
        result = await tool.run(call.args ?? {}, ctx);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
        error = true;
      }
      steps.push({ tool: call.name!, args: call.args, result, error });
      results.push({ functionResponse: { id: call.id, name: call.name, response: { result } } });
    }

    contents.push({ role: "user", parts: results });
  }

  return { answer: "I hit my step limit. Try a simpler question.", steps };
}
