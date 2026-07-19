import test from "node:test";
import assert from "node:assert/strict";
import { buildCitationPayload } from "./chat.mjs";

test("Bedrock citation을 문장 끝 인라인 출처로 변환한다", () => {
  const reply = "호르무즈 통항 제한은 운항 비용을 높일 수 있습니다. 추가 확인이 필요합니다.";
  const citedText = "호르무즈 통항 제한은 운항 비용을 높일 수 있습니다.";
  const result = buildCitationPayload(reply, [{
    generatedResponsePart: { textResponsePart: { text: citedText, span: { start: 0, end: citedText.length - 1 } } },
    retrievedReferences: [{
      location: { type: "S3", s3Location: { uri: "s3://kb/kobc-hormuz.pdf" } },
      metadata: {
        title: "호르무즈 해운·물류 영향 분석",
        organization: "KOBC",
        published_at: "2026-03-04",
        source_page_url: "https://www.kobc.or.kr/report",
      },
    }],
  }]);

  assert.deepEqual(result.citations, [{ start: 0, end: citedText.length, sourceIds: [1] }]);
  assert.deepEqual(result.sources[0], {
    id: 1,
    title: "호르무즈 해운·물류 영향 분석",
    organization: "KOBC",
    publishedAt: "2026-03-04",
    url: "https://www.kobc.or.kr/report",
    location: "s3://kb/kobc-hormuz.pdf",
  });
});

test("같은 문서는 중복 없이 여러 인용 구간에서 재사용한다", () => {
  const reply = "첫 근거 문장. 둘째 근거 문장.";
  const reference = {
    location: { type: "S3", s3Location: { uri: "s3://kb/report.pdf" } },
    metadata: { title: "주간 보고서" },
  };
  const result = buildCitationPayload(reply, [
    {
      generatedResponsePart: { textResponsePart: { text: "첫 근거 문장." } },
      retrievedReferences: [reference],
    },
    {
      generatedResponsePart: { textResponsePart: { text: "둘째 근거 문장." } },
      retrievedReferences: [reference],
    },
  ]);

  assert.equal(result.sources.length, 1);
  assert.deepEqual(result.citations.map((citation) => citation.sourceIds), [[1], [1]]);
  assert.equal(result.citations[1].end, reply.length);
});

test("같은 PDF도 인용 페이지가 다르면 페이지별 출처로 구분한다", () => {
  const reply = "요약과 대응 방안";
  const reference = (page) => ({
    location: { type: "S3", s3Location: { uri: "s3://kb/report.pdf" } },
    metadata: { title: "보고서", "x-amz-bedrock-kb-document-page-number": page },
  });
  const result = buildCitationPayload(reply, [
    { generatedResponsePart: { textResponsePart: { text: "요약" } }, retrievedReferences: [reference(1)] },
    { generatedResponsePart: { textResponsePart: { text: "대응 방안" } }, retrievedReferences: [reference(12)] },
  ]);

  assert.deepEqual(result.sources.map((source) => source.pageNumber), [1, 12]);
  assert.deepEqual(result.citations.map((citation) => citation.sourceIds), [[1], [2]]);
});
