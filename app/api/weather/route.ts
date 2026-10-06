/**
 * A MOCK PAID WEATHER API
 *
 * Pretend this is someone else's API that charges per request.
 * No payment → 402 Payment Required. Valid signed payment → the weather.
 */
import { verifyPayment } from "@/agent/wallet";

const PRICE = "0.01";
const ASSET = "USDC";
const PAY_TO = "0x000000000000000000000000000000000000dEaD"; // the API owner's wallet (demo)

export async function GET(req: Request) {
  // `req.url` is sometimes only a path behind a proxy. The dummy base is
  // ignored when the URL is already absolute; it just stops the parse throwing.
  const city = new URL(req.url, "http://placeholder.invalid").searchParams.get("city") ?? "Unknown";

  const payment = await verifyPayment(req.headers.get("X-PAYMENT"));
  if (!payment || payment.to !== PAY_TO || Number(payment.amount) < Number(PRICE)) {
    return Response.json({ error: "Payment Required", price: PRICE, asset: ASSET, payTo: PAY_TO }, { status: 402 });
  }

  // Fake weather — swap in a real API here if you like.
  const conditions = ["Sunny", "Cloudy", "Rainy", "Windy", "Stormy"];
  return Response.json({
    city,
    temperatureC: Math.round(15 + Math.random() * 20),
    condition: conditions[Math.floor(Math.random() * conditions.length)],
    paidBy: payment.from,
  });
}
