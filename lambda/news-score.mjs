// 제목 키워드 기반 중요도 점수. 운임/시황 직결 키워드일수록 가중치를 높게 둔다.
const KEYWORD_GROUPS = [
  { weight: 3, words: ["운임", "KCCI", "SCFI", "물동량", "체선", "공급과잉"] },
  { weight: 2, words: ["항만", "컨테이너", "선사", "원양", "시황", "급등", "급락", "파업"] },
  { weight: 1, words: ["해운", "물류", "수출", "수입"] },
];

export function scoreTitle(title) {
  return KEYWORD_GROUPS.reduce((sum, { weight, words }) => {
    const hits = words.filter((word) => title.includes(word)).length;
    return sum + hits * weight;
  }, 0);
}
