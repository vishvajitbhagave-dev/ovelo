/**
 * THE MODEL ALLOWLIST
 *
 * The server is the source of truth for which Gemini models Ovelo may use.
 * The client can only ever ask for one of these ids; anything else is rejected
 * before it reaches the agent, so an arbitrary model string can never be sent.
 *
 * Every id here was tested with this app's function calling (a `roll_dice`
 * tool call) before being added. Models that are not listed are untested.
 */

export type AllowedModel = {
  /** The exact Gemini model id sent to the API. */
  id: string;
  /** A short, human-friendly name for the UI. */
  name: string;
  /** One line describing the model, shown in the dropdown. */
  note: string;
  /** The official version information we could confirm from Google's docs. */
  version: string;
};

/** Fixed fallback when neither the request nor GEMINI_MODEL names a listed model. */
export const DEFAULT_MODEL_ID = "gemini-flash-lite-latest";

export const ALLOWED_MODELS: AllowedModel[] = [
  {
    id: "gemini-flash-lite-latest",
    name: "Gemini Flash-Lite (latest)",
    note: "Today's default. Alias that always points to Google's newest Flash-Lite.",
    version: "Alias — resolves to Google's latest Flash-Lite release; no fixed version is published.",
  },
  {
    id: "gemini-3.5-flash-lite",
    name: "Gemini 3.5 Flash-Lite",
    note: "Fast and low-cost. Stable (GA).",
    version: "Stable (GA), released July 21, 2026.",
  },
  {
    id: "gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    note: "Stronger agentic and tool-calling. Stable (GA).",
    version: "Stable (GA), released July 21, 2026.",
  },
];

/** Is this exact id on the allowlist? (case-insensitive, trimmed) */
export function findAllowedModel(id: string | null | undefined): AllowedModel | null {
  if (!id) return null;
  const wanted = id.trim().toLowerCase();
  return ALLOWED_MODELS.find((m) => m.id.toLowerCase() === wanted) ?? null;
}

/**
 * Choose the model for a request:
 *  1. the explicit, allowlisted id from the client, else
 *  2. the GEMINI_MODEL env value when it is on the list, else
 *  3. the fixed default (`gemini-flash-lite-latest`).
 * Callers that accept client input must validate it first with findAllowedModel.
 */
export function resolveModel(requested?: string | null): AllowedModel {
  return (
    findAllowedModel(requested) ??
    findAllowedModel(process.env.GEMINI_MODEL) ??
    findAllowedModel(DEFAULT_MODEL_ID)!
  );
}
