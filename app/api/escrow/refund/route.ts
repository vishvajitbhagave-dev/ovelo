/**
 * POST /api/escrow/refund
 * Body: { dealId }
 * Server enforces: deal exists, status Funded, buyer is agent wallet, deadline passed.
 */
import { refundDeal } from "@/agent/escrow";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { dealId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const dealId = String(body?.dealId ?? "").trim();
  if (!dealId) {
    return Response.json({ error: "Missing dealId." }, { status: 400 });
  }
  try {
    const id = BigInt(dealId);
    const result = await refundDeal({ dealId: id });
    if (!result.ok) {
      return Response.json({ ok: false, message: result.message }, { status: 200 });
    }
    return Response.json(result, { status: 200 });
  } catch {
    return Response.json({ error: "dealId must be a number." }, { status: 400 });
  }
}