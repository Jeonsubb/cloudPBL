import { getDashboardPayload } from "@/lib/dashboard-providers";

export const dynamic = "force-dynamic";

export async function GET() {
  const payload = await getDashboardPayload();
  return Response.json(payload, {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=900",
      "x-portpulse-schema": payload.schemaVersion,
      "x-portpulse-data-mode": payload.mode.toLowerCase(),
    },
  });
}
