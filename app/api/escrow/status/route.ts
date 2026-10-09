/**
 * GET /api/escrow/status
 *
 * Public escrow status for the Agent wallet tab: the agent address and its real
 * Base Sepolia ETH and test USDC balances, plus the number of demo deals opened
 * and the safety caps. Never returns a private key.
 */
import { getEscrowStatus } from "@/agent/escrow";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getEscrowStatus();
    return Response.json(status);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Could not read escrow status." },
      { status: 500 }
    );
  }
}
