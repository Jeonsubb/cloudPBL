import { answerPortPulseQuestion } from "@/lib/portpulse";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "올바른 JSON 요청이 아닙니다." }, { status: 400 });
  }
  const message = typeof body === "object" && body !== null && "message" in body
    ? String((body as { message: unknown }).message).trim()
    : "";
  if (!message) return Response.json({ error: "질문을 입력해 주세요." }, { status: 400 });
  if (message.length > 500) return Response.json({ error: "질문은 500자 이내로 입력해 주세요." }, { status: 413 });
  return Response.json(answerPortPulseQuestion(message), {
    headers: { "cache-control": "no-store", "x-portpulse-chat-mode": "deterministic-grounded" },
  });
}
