export type FriendlyError = {
  /** Plain sentence safe to show in the UI. */
  message: string;
  /** The original string, kept for the collapsed "Technical details". */
  technical: string;
};

export const GENERIC_ERROR_MESSAGE =
  "Something went wrong while checking this ticket. Please try again.";

export const SETTLE_FAILED_MESSAGE =
  "The payment service did not confirm the report payment. Ovelo could not confirm that anything was charged. Please try again in a minute.";

const SETTLE_PROBLEM = /settle_failed|tried twice|x402 payment was not settled/i;

const ALREADY_PLAIN = [
  /^You have reached the chat limit for now\./i,
  /^You have used your paid reports for now\./i,
  /^Paid call limit reached, try again later\./i,
  /^Could not reach the server/i,
  /^Add GEMINI_API_KEY/i,
  /^The agent has no wallet yet\./i,
  /^The history report was not returned for this ticket\.$/i,
  /^The history report could not be bought\.$/i,
];

/**
 * UI-only translation of technical tool/API errors. It never changes the
 * error strings thrown by the agent, x402 code or tools themselves.
 */
export function friendlyError(raw: unknown): FriendlyError {
  const technical = raw instanceof Error ? raw.message : raw == null ? "" : String(raw);
  const trimmed = technical.trim();

  if (!trimmed) {
    return { message: GENERIC_ERROR_MESSAGE, technical };
  }

  if (SETTLE_PROBLEM.test(trimmed)) {
    return { message: SETTLE_FAILED_MESSAGE, technical };
  }

  if (ALREADY_PLAIN.some((pattern) => pattern.test(trimmed))) {
    return { message: trimmed, technical };
  }

  return { message: GENERIC_ERROR_MESSAGE, technical };
}
