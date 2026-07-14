"""
PortPulse - 해운 뉴스 수집·요약 에이전트
운임 영향 뉴스(홍해, 파업, 유가, 얼라이언스 개편 등) 수집 후 Bedrock으로 요약·분류
"""

import json
import os
import sys
import re
import requests
import feedparser
import boto3
from datetime import datetime, date
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from shared.db import get_db

BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "ap-northeast-2")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "apac.anthropic.claude-sonnet-4-20250514-v1:0")

# 해운·물류 뉴스 RSS 피드
NEWS_FEEDS = [
    {
        "name": "해양수산부 보도자료",
        "url": "https://www.mof.go.kr/rss/article/bodo.xml",
        "type": "rss",
    },
    {
        "name": "코리아쉬핑가제트",
        "url": "http://www.ksg.co.kr/rss/allnews.xml",
        "type": "rss",
    },
    {
        "name": "해운뉴스",
        "url": "https://www.maritimepress.co.kr/rss/allArticle.xml",
        "type": "rss",
    },
    {
        "name": "gCaptain",
        "url": "https://gcaptain.com/feed/",
        "type": "rss",
    },
    {
        "name": "FreightWaves",
        "url": "https://www.freightwaves.com/feed",
        "type": "rss",
    },
    {
        "name": "Hellenic Shipping News",
        "url": "https://www.hellenicshippingnews.com/feed/",
        "type": "rss",
    },
    {
        "name": "Splash247",
        "url": "https://splash247.com/feed/",
        "type": "rss",
    },
]

# 운임 관련 키워드 (필터링용)
FREIGHT_KEYWORDS = [
    "운임", "KCCI", "SCFI", "컨테이너", "선복", "부킹",
    "홍해", "수에즈", "파나마", "파업", "GRI", "성수기",
    "얼라이언스", "선사", "항만", "혼잡", "체선",
    "유가", "벙커유", "BAF", "할증",
    "부산항", "물동량", "수출", "TEU", "FEU",
    "container freight", "ocean freight", "freight rate", "spot rate",
    "container shipping", "port congestion", "red sea", "suez",
    "panama canal", "port strike", "bunker fuel", "peak season",
    "ocean carrier", "shipping tariff",
]

MAX_ITEMS_PER_FEED = 15
MAX_ARTICLES_PER_RUN = 20


def handler(event, context):
    """뉴스 수집 Lambda 핸들러"""
    print(f"News collector triggered at {datetime.now().isoformat()}")

    try:
        # 1. RSS 피드에서 뉴스 수집
        raw_articles = collect_from_feeds()
        print(f"Collected {len(raw_articles)} raw articles")

        # 2. 운임 관련 뉴스 필터링
        filtered = filter_relevant_articles(raw_articles)
        print(f"Filtered to {len(filtered)} relevant articles")

        # 이미 저장한 기사는 Bedrock에 다시 보내지 않는다.
        filtered = exclude_existing_articles(filtered)[:MAX_ARTICLES_PER_RUN]
        print(f"New articles to analyze: {len(filtered)}")

        if not filtered:
            return {"statusCode": 204, "body": "No relevant news found"}

        # 3. Bedrock으로 요약·분류·영향도 판단
        analyzed = analyze_articles(filtered)
        print(f"Analyzed {len(analyzed)} articles")

        # 4. DB 저장
        save_to_db(analyzed)

        return {"statusCode": 200, "body": f"Saved {len(analyzed)} news articles"}

    except Exception as e:
        print(f"News collector error: {e}")
        return {"statusCode": 500, "body": str(e)}


def collect_from_feeds():
    """RSS 피드에서 뉴스 수집"""
    articles = []
    seen = set()

    for feed_info in NEWS_FEEDS:
        try:
            response = requests.get(
                feed_info["url"],
                headers={"User-Agent": "Mozilla/5.0 (compatible; PortPulse/1.0)"},
                timeout=10,
            )
            response.raise_for_status()
            feed = feedparser.parse(response.content)

            for entry in feed.entries[:MAX_ITEMS_PER_FEED]:
                title = entry.get("title", "").strip()
                link = entry.get("link", "").strip()
                dedupe_key = link or title.casefold()
                if not title or not dedupe_key or dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                articles.append({
                    "title": title,
                    "link": link,
                    "summary": entry.get("summary", entry.get("description", "")),
                    "published": entry.get("published", ""),
                    "source": feed_info["name"],
                })

        except Exception as e:
            print(f"Feed error ({feed_info['name']}): {e}")
            continue

    return articles


def filter_relevant_articles(articles):
    """운임 관련 키워드로 필터링"""
    relevant = []

    for article in articles:
        text = f"{article['title']} {article.get('summary', '')}"
        # HTML 태그 제거
        text = BeautifulSoup(text, "html.parser").get_text()
        lowered = text.casefold()

        if any(kw.casefold() in lowered for kw in FREIGHT_KEYWORDS):
            article["clean_text"] = text[:500]  # 분석용 텍스트 제한
            relevant.append(article)

    return relevant


def exclude_existing_articles(articles):
    """최근 저장된 제목을 제외해 중복 Bedrock 호출을 막는다."""
    if not articles:
        return []

    db = get_db()
    rows = db.query(
        """
        SELECT title FROM news
        ORDER BY created_at DESC
        LIMIT 500
        """
    )
    existing_titles = {row["title"].strip().casefold() for row in rows if row.get("title")}
    return [
        article
        for article in articles
        if article["title"].strip().casefold() not in existing_titles
    ]


def analyze_articles(articles):
    """Bedrock Claude로 뉴스 분석 (배치)"""
    bedrock = boto3.client("bedrock-runtime", region_name=BEDROCK_REGION)

    # 최대 5개씩 배치 분석
    batch_size = 5
    analyzed = []

    for i in range(0, len(articles), batch_size):
        batch = articles[i:i + batch_size]
        batch_text = "\n\n".join(
            f"[{j+1}] 제목: {a['title']}\n내용: {a.get('clean_text', '')[:300]}"
            for j, a in enumerate(batch)
        )

        prompt = f"""다음 해운·물류 뉴스를 분석해주세요. 각 뉴스에 대해 JSON 배열로 응답해주세요.

{batch_text}

각 뉴스에 대해:
1. summary: 1-2문장 요약 (한국어)
2. category: 분류 (홍해, 항만혼잡, 운임인상, 파업, 유가, 얼라이언스, 성수기, 기타 중 택1)
3. impact_level: 부산발 운임에 대한 영향도 (HIGH/MEDIUM/LOW)

JSON 배열만 출력 (마크다운 없이):
[{{"index": 1, "summary": "...", "category": "...", "impact_level": "..."}}]"""

        try:
            response = bedrock.invoke_model(
                modelId=BEDROCK_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=json.dumps({
                    "anthropic_version": "bedrock-2023-05-31",
                    "max_tokens": 1500,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2,
                }),
            )

            result = json.loads(response["body"].read())
            content = result["content"][0]["text"]

            # JSON 파싱
            content = content.strip()
            if content.startswith("```"):
                content = re.sub(r"```(?:json)?\n?", "", content).strip()

            analysis_list = json.loads(content)

            for analysis in analysis_list:
                idx = analysis.get("index", 1) - 1
                if idx < len(batch):
                    article = batch[idx]
                    analyzed.append({
                        "title": article["title"],
                        "summary": analysis.get("summary", ""),
                        "category": analysis.get("category", "기타"),
                        "impact_level": analysis.get("impact_level", "LOW"),
                        "source_url": article.get("link", ""),
                        "published_date": _parse_date(article.get("published", "")),
                    })

        except Exception as e:
            print(f"Bedrock analysis error for batch: {e}")
            # 폴백: 키워드 기반 분류
            for article in batch:
                analyzed.append({
                    "title": article["title"],
                    "summary": article.get("clean_text", "")[:100],
                    "category": _keyword_classify(article["title"]),
                    "impact_level": "MEDIUM",
                    "source_url": article.get("link", ""),
                    "published_date": _parse_date(article.get("published", "")),
                })

    return analyzed


def save_to_db(articles):
    """분석된 뉴스를 DB에 저장"""
    db = get_db()

    for article in articles:
        # 중복 체크 (제목 기반)
        existing = db.query(
            "SELECT id FROM news WHERE title = :title",
            {"title": article["title"]},
        )

        if not existing:
            db.execute(
                """
                INSERT INTO news (title, summary, category, source_url, impact_level, published_date)
                VALUES (:title, :summary, :category, :source_url, :impact_level,
                        CAST(:published_date AS DATE))
                """,
                {
                    "title": article["title"],
                    "summary": article["summary"],
                    "category": article["category"],
                    "source_url": article["source_url"],
                    "impact_level": article["impact_level"],
                    "published_date": article["published_date"],
                },
            )


def _keyword_classify(title):
    """키워드 기반 뉴스 분류 (Bedrock 폴백용)"""
    if any(kw in title for kw in ["홍해", "수에즈", "후티"]):
        return "홍해"
    elif any(kw in title for kw in ["파업", "노조"]):
        return "파업"
    elif any(kw in title for kw in ["GRI", "인상", "급등"]):
        return "운임인상"
    elif any(kw in title for kw in ["혼잡", "체선", "적체"]):
        return "항만혼잡"
    elif any(kw in title for kw in ["유가", "벙커"]):
        return "유가"
    elif any(kw in title for kw in ["얼라이언스", "제휴"]):
        return "얼라이언스"
    return "기타"


def _parse_date(date_str):
    """다양한 날짜 형식 파싱"""
    if not date_str:
        return date.today().isoformat()

    formats = [
        "%a, %d %b %Y %H:%M:%S %z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt).date().isoformat()
        except ValueError:
            continue

    return date.today().isoformat()
