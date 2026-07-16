// 추천 재평가 모니터 — 매일 스케줄로 현재 선적 추천을 다시 계산해,
// 직전 저장된 stance와 달라졌으면(예: CONSIDER_WAIT → BOOK_NOW) 텔레그램으로 알린다.
// "기다리라 했다가 시장이 뒤집히면 알려주는" 완성형 — 추천이 살아있게 만드는 핵심 루프.
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { computeRecommendation, lastStoredStance, storeRecommendation } from "./recommend.mjs";

const TELEGRAM_SECRET = process.env.TELEGRAM_SECRET_NAME;
const sm = new SecretsManagerClient({});

const STANCE_KO = {
  BOOK_NOW: "지금 예약", BOOK_SOON: "곧 예약", CONSIDER_WAIT: "관망", DEADLINE_RISK: "납기 위험",
};

async function telegram(text) {
  if (!TELEGRAM_SECRET) { console.log("텔레그램 시크릿 미설정 — 전송 건너뜀\n", text); return; }
  let creds;
  try {
    const s = await sm.send(new GetSecretValueCommand({ SecretId: TELEGRAM_SECRET }));
    creds = JSON.parse(s.SecretString);
  } catch (e) { console.warn("텔레그램 시크릿 로드 실패:", e.message); return; }
  const { botToken, chatId } = creds;
  if (!botToken || !chatId) { console.warn("botToken/chatId 없음 — 전송 건너뜀"); return; }
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
}

export async function handler() {
  // 1) 저장 전에 직전 stance를 확보하려면 먼저 store:false로 계산
  const { brief, recommendation } = await computeRecommendation({ store: false });
  const prev = await lastStoredStance(brief.shipment.id);
  await storeRecommendation(brief, recommendation);

  const cur = recommendation.stance;
  const changed = prev && prev !== cur;
  console.log(`재평가 ${brief.shipment.id}: ${prev ?? "(최초)"} → ${cur}${changed ? " [변경]" : ""}`);

  if (changed) {
    const s = recommendation.recommendedSailing ?? {};
    const m = brief.market ?? {};
    const msg =
      `🚢 <b>${brief.company} · ${brief.shipment.id}</b>\n` +
      `${brief.shipment.lane} · ${brief.shipment.equipment}×${brief.shipment.containers}\n\n` +
      `추천이 <b>${STANCE_KO[prev] ?? prev} → ${STANCE_KO[cur] ?? cur}</b> 로 바뀌었습니다.\n` +
      `“${recommendation.verdict}”\n\n` +
      `· 추천 항차: ${s.operator ?? ""} ${s.vessel ?? "-"} (ETD ${s.etd ?? "-"} → ETA ${s.eta ?? "-"})\n` +
      `· ${m.routeLabel ?? ""} KCCI ${m.indexNow ?? "-"}pt · 52주 백분위 ${m.pctile52 ?? "-"}\n` +
      `· 예산 $${brief.shipment.budgetPerFeu ?? "-"}/FEU\n\n` +
      `대시보드에서 근거 전체를 확인하세요.`;
    await telegram(msg);
    return { changed: true, prev, cur };
  }
  return { changed: false, cur };
}
