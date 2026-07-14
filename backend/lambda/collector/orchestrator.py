"""
PortPulse - 데이터 수집 오케스트레이터
EventBridge 스케줄에 의해 모드별 실행

스케줄:
  06:00 KST  → mode="full"      전체 수집 (KCCI + SCFI + 관세청 + 환율 + 뉴스)
  09~18 KST  → mode="exchange"  환율만 (영업시간 30분마다)
  월요일 오후 → mode="kcci"      KCCI 발표 직후 재확인
  금요일 오후 → mode="scfi"      SCFI 발표 직후 재확인
  매시간      → mode="news"      뉴스만 (매시간)

데이터 갱신 주기 참고:
  - KCCI: 주 1회 (월요일), SCFI: 주 1회 (금요일)
  - 환율: 실시간 변동 → 영업시간 30분 간격
  - 뉴스: 수시 → 매시간
  - 관세청: 월 1회 → 매일 아침 체크
"""

import json
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

# 개별 수집기 임포트
from .kcci_collector import handler as kcci_handler
from .scfi_collector import handler as scfi_handler
from .ecos_collector import handler as ecos_handler
from .customs_collector import handler as customs_handler
from .news_collector import handler as news_handler


def handler(event, context):
    """
    데이터 수집 오케스트레이터

    event.mode:
      "full"     - 전체 수집 (매일 아침 06:00)
      "exchange" - 환율만 (영업시간 30분마다)
      "kcci"     - KCCI만 (월요일 발표 직후)
      "scfi"     - SCFI만 (발표 직후)
      "news"     - 뉴스만 (매시간)
    """
    mode = event.get("mode", "full")
    print(f"=== PortPulse Data Collection [{mode.upper()}]: {datetime.now().isoformat()} ===")

    results = {}
    errors = []

    if mode == "full":
        # === 전체 수집 (매일 아침 1회) ===

        # 1. KCCI 운임지수 (주간이지만 매일 체크 → 금요일에 새 데이터 잡힘)
        _run_collector("KCCI", kcci_handler, event, context, results, errors)

        # 2. SCFI 운임지수 (주간 발표)
        _run_collector("SCFI", scfi_handler, event, context, results, errors)

        # 3. 관세청 수출통계 (월간이지만 매일 체크)
        _run_collector("Customs", customs_handler, event, context, results, errors)

        # 4. 환율·금리
        _run_collector("ECOS", ecos_handler, event, context, results, errors)

        # 5. 뉴스
        _run_collector("News", news_handler, event, context, results, errors)

    elif mode == "exchange":
        # === 환율만 (영업시간 30분마다) ===
        _run_collector("ECOS", ecos_handler, event, context, results, errors)

    elif mode == "kcci":
        # === KCCI만 (월요일 발표 직후 재확인) ===
        _run_collector("KCCI", kcci_handler, event, context, results, errors)

    elif mode == "scfi":
        # === SCFI만 (금요일 발표 직후 재확인) ===
        _run_collector("SCFI", scfi_handler, event, context, results, errors)

    elif mode == "news":
        # === 뉴스만 (매시간) ===
        _run_collector("News", news_handler, event, context, results, errors)

    else:
        return {"statusCode": 400, "body": f"Unknown mode: {mode}"}

    # 마지막 동기화 시각 기록
    _update_last_sync_time(mode)

    # 결과 종합
    summary = {
        "mode": mode,
        "timestamp": datetime.now().isoformat(),
        "results": {k: v.get("body", "") for k, v in results.items()},
        "errors": errors,
        "success": len(errors) == 0,
    }

    print(f"=== [{mode.upper()}] Complete: {len(errors)} errors ===")
    return {
        "statusCode": 200 if not errors else 207,
        "body": json.dumps(summary, default=str, ensure_ascii=False),
    }


def _run_collector(name, handler_fn, event, context, results, errors):
    """개별 수집기 실행 래퍼"""
    try:
        print(f"  Collecting {name}...")
        result = handler_fn(event, context)
        results[name.lower()] = result
        if result.get("statusCode", 500) >= 400:
            raise RuntimeError(result.get("body", f"{name} collector failed"))
        print(f"  → {name}: {result.get('body', 'done')}")
    except Exception as e:
        errors.append(f"{name}: {e}")
        print(f"  → {name} ERROR: {e}")


def _update_last_sync_time(mode):
    """마지막 동기화 시각을 DB에 기록 (프론트엔드 Ticker 표시용)"""
    try:
        from shared.db import get_db
        db = get_db()

        # sync_status 레코드 upsert
        now = datetime.now().isoformat()
        db.execute(
            """
            INSERT INTO market_data (data_type, route, index_value, recorded_date, raw_data)
            VALUES ('sync_status', :mode, 1, CURRENT_DATE, CAST(:raw_data AS JSONB))
            ON CONFLICT DO NOTHING
            """,
            {
                "mode": mode,
                "raw_data": json.dumps({"last_sync": now, "mode": mode}),
            },
        )
    except Exception as e:
        print(f"Sync time update failed (non-critical): {e}")
