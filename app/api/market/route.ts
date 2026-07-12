import { getMarketPayload } from "@/lib/market-providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getMarketPayload();
  return Response.json(payload, {
    headers: {
      "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      "x-portpulse-data-mode": payload.health.exchange === "LIVE" ? "mixed-live" : "fallback",
    },
  });
}
