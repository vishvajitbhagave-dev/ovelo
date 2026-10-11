import { MODEL, runAgent } from "@/agent/agent";
import { tools } from "@/agent/tools";
import { ALLOWED_MODELS, DEFAULT_MODEL_ID, findAllowedModel } from "@/agent/models";

// GET /api/agent -> setup status + the list of tools and models (shown on the page)
export async function GET() {
  return Response.json({
    hasApiKey: Boolean(process.env.GEMINI_API_KEY),
    model: MODEL,
    defaultModel: findAllowedModel(process.env.GEMINI_MODEL)?.id ?? DEFAULT_MODEL_ID,
    models: ALLOWED_MODELS.map((m) => ({ id: m.id, name: m.name, note: m.note })),
    tools: tools.map((t) => ({ name: t.name, description: t.description })),
  });
}

// POST /api/agent { messages } -> the agent's answer + the tools it used
/**
 * Work out the public origin of this request so the agent can call its own
 * paid APIs. Behind a proxy (Vercel) `req.url` may be relative, which would
 * make `new URL()` throw, so build it from the forwarded headers instead.
 */
function requestOrigin(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    return `${proto}://${host}`;
  }
  try {
    return new URL(req.url).origin;
  } catch {
    return req.headers.get("origin") ?? "";
  }
}

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json({ error: "Add GEMINI_API_KEY to your .env file, then restart `npm run dev`." }, { status: 500 });
  }

  const { messages, model } = await req.json();

  // Only allowlisted models are accepted; an arbitrary client string is rejected.
  if (model !== undefined && model !== null && !findAllowedModel(model)) {
    return Response.json(
      { error: `Unknown model "${String(model)}". Choose one of the supported models.` },
      { status: 400 }
    );
  }

  try {
    const result = await runAgent(messages, { baseUrl: requestOrigin(req) }, { model });
    return Response.json(result);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
