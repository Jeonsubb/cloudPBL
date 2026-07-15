// 해운 전문지 RSS 소스. 2026-07-14 실호출로 검증됨.
// 한국해운신문(maritimepress.co.kr)은 RSS가 엉뚱한 사이트 콘텐츠를 반환하는 버그가 확인되어 제외.
export const NEWS_SOURCES = [
  {
    id: "haesanews",
    label: "해사신문",
    // "Shipping Market" 카테고리 — 전체기사 대신 이미 운임/시황으로 필터링된 피드.
    url: "http://www.haesanews.com/rss/S1N1.xml",
  },
  {
    id: "cargotimes",
    label: "해운산업신문",
    url: "https://www.cargotimes.net/rss/allArticle.xml",
  },
  {
    id: "shippingnewsnet",
    label: "쉬핑뉴스넷",
    url: "http://www.shippingnewsnet.com/rss/allArticle.xml",
  },
  {
    id: "haesainfo",
    label: "해사정보신문",
    url: "https://www.haesainfo.com/rss/allArticle.xml",
  },
];
