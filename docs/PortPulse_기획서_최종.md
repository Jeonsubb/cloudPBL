# PortPulse 기획서 — 고도화 최종안

> 작성 기준일: 2026-07-13
> 대상: 부산·경남권 컨테이너 수출 중소기업
> 서비스 성격: 운임 예측·자동 부킹 서비스가 아니라, 선적계획과 포워더 견적을 근거로 다음 행동을 제안하는 의사결정 지원 서비스

---

## 0. 한 줄 정의

PortPulse는 **회사 데이터 없이도 오늘의 해양물류 뉴스·환율·금리·부산발·글로벌 운임을 출처와 기준일과 함께 보여주고**, 선적계획과 포워더 견적을 연결하면 같은 비용 범위로 비교해 **견적 수용·재견적·관찰·수동검토 중 다음 행동과 기한을 근거·신뢰도와 함께 제시**한다.

기존 문서의 “지금 부킹할지 2주 기다릴지 맞히는 서비스”보다 범위를 현실화했다. 공개데이터만으로 미래 운임, 선복, 정확한 ETA를 보장할 수 없기 때문에 PortPulse는 예측을 사실처럼 말하지 않는다.

---

## 1. 최신 근거로 다시 정의한 문제

### 1-1. 최근 조사에서 확인되는 현장 문제

| 근거 | 조사 범위 | 핵심 결과 | PortPulse가 다룰 수 있는 부분 | 해석 시 주의 |
|---|---|---|---|---|
| 부산상의 중동사태 영향 조사, 2026-05 | 부산지역 주요 수출기업 500개사 | 93.1%가 물류비 증가를 체감, 32.7%가 물류비 증가를 주요 피해로 응답, 37.7%는 대응방안이 없다고 응답 | 운임·할증료 변화의 회사별 예산 영향과 대응기한 표시 | 특정 지정학 위기 기간의 지역 조사이며 전체 수출기업으로 일반화하지 않음 |
| 무역협회 수출기업 물류애로 비상대책반, 2026-03 | 193개 기업, 469건 접수 | 운항 지연 27.5%, 운임·전쟁할증료 24.9%, 예약 취소·선적 거부 16.0%, 계류·적체 15.1% | 견적 유효기간, 스케줄·마감, 비용 항목, 이벤트 경보를 한 화면에서 관리 | 자발적 애로 접수 건이므로 모집단 비율이 아님 |
| 무역협회 2026년 경영환경 전망, 2026-01 | 국내 수출기업 1,193개사 | 72.5%가 수입 원자재·물류비 상승 등으로 수출단가 인하 여력이 없다고 응답 | 물류비가 계약 마진·예산에 미치는 노출액 계산 | 물류비만의 단독 효과가 아님 |
| 관세청 해상 수출 운송비, 2026-05 신고분 | 40ft·2TEU, FCL, 단일 화주, CIF/CFR 신고자료 | 미서부 543.2만원, 미동부 563.9만원, EU 371.4만원, 중동 681.3만원이며 중동은 전년 동월 대비 100.2% 증가 | KCCI와 정의가 다른 월간 총 운송비 벤치마크로 별도 제공 | 국가·권역 평균이며 개별 견적, 20ft·LCL·리퍼에 직접 적용하지 않음 |
| 중기부 미 관세 대응 조사, 2025-05 | 대미 수출 중소기업 조사 | 상호관세 부과 시 81.0%가 부정적 영향 예상, 관세정보 파악 애로 43.9%, 계약 지연·취소 42.4% | HS·국가 기준 공신력 있는 통상정보 연결과 체크리스트 | PortPulse가 관세율 판정·법률 자문을 대신할 수는 없음 |
| 무역협회 홍해사태 조사, 2024-01 | 수출입기업 110개사 | 74.6%가 물류 애로, 세부적으로 운임 인상 44.3%, 운송 지연 24.1%, 선복 20.2% | 비용과 일정 리스크를 함께 보는 기능 | 위기 초기의 소규모 조사 |

### 1-2. 구조적인 페인포인트

1. **견적 총액만 보면 비교 기준이 어긋난다.**
   해상 기본운임, BAF·LSS 같은 해상 할증료, 국내 THC·문서비, 도착지 비용, 내륙운송비가 한 금액에 섞여 있다. KCCI와 포워더의 Door 견적 총액을 그대로 비교하면 잘못된 결론이 나온다.

2. **기다릴 수 있는 선적과 기다릴 수 없는 선적을 구분하지 못한다.**
   Cargo Ready Date, ETD 가능 구간, 납기, CY·서류·VGM 마감, 환적 여부가 있어야 기다림의 여유를 계산할 수 있다. 시장지수만으로는 부킹 타이밍을 결정할 수 없다.

3. **수출자가 실제로 통제하지 않는 거래도 많다.**
   Incoterms만 보고 단정하지 말고 국제운송비 부담자와 부킹 주체를 확인해야 한다. 바이어가 부킹하는 거래에는 “지금 부킹” 권고 대신 바이어·포워더 확인 요청과 마감 경보가 적절하다.

4. **계획·견적·부킹·정산 데이터가 문서와 엑셀에 흩어져 있다.**
   Invoice, Packing List, 포워더 견적, Booking Confirmation, B/L, 수출신고필증, 정산서가 서로 다른 양식이라 같은 선적 건의 계획 대비 실제 비용·지연을 추적하기 어렵다.

5. **시장 데이터에는 명확한 한계가 있다.**
   KCCI는 부산발 40ft Dry Spot 운임의 주간 벤치마크이고, SCFI는 상하이발 지수이며 역사 데이터와 재배포에 구독·라이선스 제약이 있다. 무료 공공데이터로 미래 선복, 상업 스케줄, 개별 화물의 정확한 ETA를 확보할 수 없다.

### 1-3. 기존 기획에서 바로잡은 전제

| 기존 전제 | 고도화 원칙 |
|---|---|
| KCCI·SCFI·뉴스는 모두 무료 API로 매일 자동 수집 가능 | KCCI는 공공데이터 이용범위가 제한 없음이지만 주 1회 발표이며 공식 화면 구조 변경에 대비해야 한다. SCFI는 비상업 목적도 공개 재배포가 허용되지 않는다. 뉴스는 공식 RSS 또는 계약된 검색 API만 사용한다. |
| 시장지수만으로 2주 뒤 운임을 예측해 부킹 시점을 정한다 | 시장 방향, 견적 유효기간, 납기 여유, 비용 편차를 결합해 다음 행동을 제안한다. 정확한 미래 가격은 약속하지 않는다. |
| 모든 컨테이너 견적을 KCCI와 비교한다 | 부산발 40ft Dry FCL이면서 비용 범위가 맞을 때만 직접 비교한다. 20ft·LCL·리퍼·위험물·OOG는 추세 참고 또는 비교 불가다. |
| PORT-MIS가 미래 선복과 스케줄을 제공한다 | 공공 PORT-MIS 계열 데이터는 입출항 실적과 사후 검증에 적합하다. 미래 ETD·ETA·Cut-off·Space는 견적/Booking Confirmation 또는 제휴 데이터가 필요하다. |
| Bedrock 멀티에이전트가 계산과 최종 판단을 한다 | 계산과 판정은 버전이 있는 규칙엔진이 담당한다. Bedrock은 구조화된 결과를 이해하기 쉽게 설명하고 근거를 요약한다. |

---

## 2. 타깃과 서비스 경계

### 2-1. 1차 타깃

- 부산항에서 정기적으로 컨테이너 수출을 하는 부산·경남 제조 중소기업
- 40GP·40HC Dry FCL 비중이 높고 Spot 또는 단기 포워더 견적을 비교하는 기업
- 수출자가 국제운송비를 부담하거나 부킹을 직접 통제하는 거래
- 전담 물류 인력이 적고 견적·일정·정산을 엑셀과 이메일로 관리하는 기업

### 2-2. 제한적으로 지원

- 20ft Dry, LCL, Reefer, Dangerous Goods, OOG: 선적·마감 관리와 회사 예산 비교는 가능하나 KCCI 절대금액 비교는 하지 않거나 낮은 신뢰도로 표시
- FOB·FCA 등 바이어 부킹 거래: 시장 정보와 일정 경보는 제공하되 수출자에게 부킹 실행을 권하지 않음
- 장기계약 운임: Spot 시장과 차이를 보여주되 계약 조건을 고려하지 않은 “비싸다/싸다” 판정은 금지

### 2-3. MVP에서 제외

- 선사·포워더 시스템에 실제 부킹을 자동 실행하는 기능
- 공개데이터만으로 실시간 선복·장비 재고·정확한 ETA를 보장하는 기능
- 개별 기업 데이터를 섞은 업계 평균 벤치마크
- 목업 데이터로 학습한 운임 예측 ML과 절감액 정확도 주장
- 관세율·HS·원산지의 법적 확정 또는 통관 대행

---

## 3. 사용자가 해결하려는 일

> “오늘 해양물류 시장에서 무엇이 변했고, 우리 선적에 영향을 줄 가능성이 있는가? 이번 선적을 제때 보내면서 예산을 지키려면 어느 견적을 언제까지 선택해야 하는가?”

PortPulse는 이 질문을 다섯 단계로 나눈다.

1. **시장 변화**: 최신 공식 뉴스·환율·금리·운임에서 무엇이 바뀌었는가?
2. **부킹 가능성**: 화물이 준비되고 각 마감을 지킬 수 있는가?
3. **비용 적정성**: 같은 비용 범위로 봤을 때 예산·시장·과거 실적과 얼마나 차이 나는가?
4. **일정 안전성**: 납기 버퍼와 환적·지연 노출은 어느 정도인가?
5. **다음 행동**: 수용, 재견적, 특정 시점까지 관찰, 수동검토 중 무엇을 언제까지 해야 하는가?

---

## 4. 사용자 흐름

### 4-0. 시장 대시보드 탐색

1. 오늘 신규 공식 소식 수와 마지막 발행시각을 확인한다.
2. ECOS USD/KRW·기준금리·국고채 3년의 관측일과 흐름을 확인한다.
3. KCCI 종합·주요 항로와 FBX 공개 스냅샷을 보되 서로 다른 단위를 직접 비교하지 않는다.
4. SCFI처럼 재배포 권한이 필요한 데이터는 숫자 대신 공식 원문과 계약 상태를 확인한다.
5. 사용자 데이터를 연결하기 전에는 시장 정보만 제공하고, 선적·견적이 연결된 뒤에만 행동 권고를 활성화한다.

### 4-1. 온보딩

- 기본 출발항과 주력 도착항
- 국제운송비 부담자와 실제 부킹 주체
- 기본 통화와 비용 비교 범위
- 회사의 일정 버퍼 기준과 예산 초과 허용치
- 알림 채널과 수신 시간

### 4-2. 새 선적 등록

1. 빠른 웹 폼 또는 표준 Excel로 선적계획 입력
2. PortPulse가 필수값·코드·날짜 순서와 지원 범위를 검증
3. 포워더 견적을 직접 입력하거나 표준 Excel로 업로드
4. 비용 항목을 해상비·출발지비·도착지비·내륙비 등으로 분류
5. 동일 범위 비교가 가능한 경우에만 시장·예산·과거 실적과 비교
6. 행동 권고와 결정기한을 표시

### 4-3. 부킹 이후

- Booking Confirmation에서 ETD·ETA와 CY·Document·VGM Cut-off 입력
- 수출신고 수리일을 입력한 경우 적재의무기한 경보
- 실제 출항·도착과 최종 정산비를 입력해 계획 대비 편차 기록
- 다음 견적 비교에 회사 자체 기준선으로 활용

---

## 5. 실제 업무에 맞춘 입력 데이터

### 5-1. 세 가지 입력 경로

| 경로 | 용도 | MVP 여부 |
|---|---|---|
| 빠른 선적계획 폼 | 신규 선적 한 건을 3~5분 안에 등록 | 필수 |
| PortPulse 표준 Excel | 여러 선적·견적·비용 항목을 일괄 등록 | 필수 |
| 기존 문서 업로드 후 필드 매핑 | Invoice, Packing List, 견적서, Booking Confirmation을 파싱하고 사용자가 확정 | 2단계 |

기존 문서를 아무 검토 없이 자동 확정하지 않는다. 추출값, 원문 위치, 신뢰도를 보여주고 사용자가 승인한 값만 운영 데이터로 적재한다.

### 5-2. 부킹 전 최소 선적계획 스키마

| 필드 | 필수 조건 | 기업이 이미 확인하는 근거 | 쓰임 |
|---|---|---|---|
| shipment_ref | 필수 | 사내 주문·선적 관리번호 | 모든 문서 연결키 |
| cargo_ready_date | 필수 | 생산·출고 계획 | 가능한 최초 선적일 |
| etd_window_start / etd_window_end | 둘 중 납기와 함께 하나 이상 | 출고·영업 계획 | 기다릴 수 있는 기간 |
| required_delivery_date | ETD 구간이 없으면 필수 | 계약·PO 납기 | 일정 버퍼 계산 |
| pol_unlocode / pod_unlocode | 필수 | 견적·S/R | 정확한 항구 식별 및 KCCI 항로 매핑 |
| load_type | 필수 | FCL/LCL 수배 | 검증 로직 분기 |
| equipment_size_type / container_count | FCL이면 필수 | 견적·Booking Request | 단위운임·물량 계산 |
| package_count / gross_weight_kg / volume_cbm | LCL이면 필수 | Packing List | W/M 견적 검증 |
| cargo_profile | 필수 | Dry/Reefer/DG/OOG | 지원 범위와 조건부 필드 결정 |
| incoterm_code / named_place / version | 필수 | 계약·Invoice | 책임 범위 확인 |
| main_carriage_payer / booking_controller | 필수 | 실제 계약 운영 | 부킹 권고 가능 여부 |
| hard_deadline_yn / max_shift_days | 필수 | 영업·생산 담당 판단 | 관찰 가능기간 계산 |
| target_amount / currency / cost_scope | 예산경보 사용 시 필수 | 회사 견적 기준·예산 | 같은 범위의 예산 비교 |
| HS6, 거래품명, 원산지 | 통상·품목 정보 사용 시 | Invoice·수출신고 | 공공 통계·규제 정보 연결 |

### 5-3. 화물별 조건부 필드

- Reefer: 설정온도, 허용범위, 필요 시 환기·습도
- Dangerous Goods: UN Number, Proper Shipping Name, Class, Packing Group, Marine Pollutant, 해당 시 Flash Point
- OOG: 길이·폭·높이·중량과 장비종류
- LCL: 포장수, 총중량, CBM, W/M 과금기준

MVP의 KCCI 직접 비교는 Dry 40ft FCL만 활성화한다. 나머지는 회사 예산·복수견적 비교와 마감 관리부터 제공한다.

### 5-4. 견적은 Header와 Charge Line으로 분리

#### 견적 Header

- quote_ref, shipment_ref, quoted_at, valid_until
- 포워더, 선사, POL, POD, 장비, 수량
- ETD, ETA, Transit Days, Direct/Transshipment
- 견적 총액, 통화, 총액의 비용범위
- Free Time과 취소·변경 조건

#### 견적 Charge Line

- charge_code / charge_name
- category: OCEAN_BASE, FUEL_SURCHARGE, ORIGIN_LOCAL, DESTINATION_LOCAL, INLAND, CUSTOMS, INSURANCE, OTHER
- amount, currency, basis: PER_SHIPMENT, PER_BL, PER_CONTAINER, PER_TEU, PER_FEU, PER_CBM, W_M
- quantity, prepaid_collect, 총액 포함 여부
- KCCI 비교대상 포함 여부와 그 근거

총액 하나만 받으면 KCCI 비교와 실제 절감액 계산을 수행하지 않는다.

### 5-5. 부킹·통관 이후 선택 데이터

- booking_no, booking_status, booked_at
- carrier, vessel, voyage, planned_etd, planned_eta
- CY Cut-off, Document Cut-off, VGM Cut-off
- MBL/HBL, container_no, seal_no, VGM
- export_declaration_no, declaration_accepted_at
- actual_departure, actual_arrival
- 실제 정산 Charge Line과 적용환율

B/L·컨테이너번호·수출신고번호는 부킹 전 필수가 아니다.

---

## 6. 공공·외부 데이터의 현실적인 사용

| 데이터 | 실제 쓰임 | 갱신·접근 | MVP 판단 |
|---|---|---|---|
| KOBC KCCI | 부산발 13개 항로의 40ft Dry Spot 시장 벤치마크와 주간 방향. Ocean Freight와 BAF·CAF·LSS·EBS 계열을 포함하고 THC·DOC 등 Local Charge는 제외 | 매주 월요일 14시 발표. 공공데이터포털 이용허락범위 제한 없음, 공식 웹 최신표·시계열 제공 | 핵심. 공식 최신표를 서버에서 읽고 원문 HTML·파서 장애 시 마지막 정상 Snapshot 사용 |
| FBX Global | 12개 주요 항로의 글로벌 40ft 컨테이너 운임 수준 | Freightos 공식 페이지는 Current FBX를 표시하고 일별 산출·주간 금요일 평균을 설명한다. 공개 부분은 Freightos 크레딧과 Terminal 링크 조건으로 재현 가능 | 공식 페이지가 관측일을 표시하지 않아 값·수동 검증시각만 제공. 자동수집·이력·AI 입력은 별도 조건 확인 전 금지 |
| SCFI | 상하이발 글로벌 방향성 참고 | 비구독자는 최신 종합지수를 지연 열람할 수 있으나 서면허가 없는 공개·상업 재배포는 금지 | 숫자·이력 비표시. 공식 원문과 `LICENSE_REQUIRED` 상태만 제공 |
| 한국은행 ECOS | USD/KRW 환율, 기준금리, 국고채 3년 금리 | 인증키 기반 공식 API. 코드 `731Y001/0000001`, `722Y001/0101000`, `817Y002/010200000` | 서버에서 사용. 키가 없으면 공식 sample 최근 10건으로 제한하고 `SAMPLE` 표시, 실제 견적 적용환율 우선 |
| 관세청 국가별 해상 수출 운송비 | 40ft FCL CIF/CFR 신고 기반 월간 총 운송비 벤치마크 | 월간 파일데이터, 국가·권역 평균 | KCCI와 분리해 Total Transport 참고값으로 사용. 정의가 맞지 않으면 비교하지 않음 |
| 관세청 품목별 수출입실적 | HS별 월간 수출금액·중량·계절성 맥락 | 공공데이터 API, 월 단위 현행화 | 보조 신호. 개별기업 운임·선복으로 해석 금지 |
| 관세청 HSK 코드 | HS/HSK 명칭 자동완성 | 연 1회 파일 | 사용 가능. 최종 분류는 기업·관세사 확인 |
| UN/LOCODE | 항구·장소 표준코드 | 버전 파일 정기 적재 | 사용 가능 |
| PORT-MIS·해수부 입출항 데이터 | 실제 출항·도착 사후 확인, 지연·혼잡의 집계 맥락 | 공개 API 또는 파일, 일부는 월 단위 | 미래 상업 스케줄·선복 신호로 사용 금지 |
| BPA ChainPortal / Port-i | 터미널·Booking·컨테이너·선석 정보 | 로그인 및 API별·터미널별 신청·승인 필요 | 승인 후 2단계 연동 |
| 포워더·선사 스케줄 | ETD·ETA, Cut-off, Space, 환적 | 계약·제휴 또는 사용자 견적/Booking Confirmation | MVP는 사용자 입력, 제휴 후 자동화 |
| 뉴스·통상정보 | 파업·항만폐쇄·관세·규제 이벤트 | 해양수산부·관세청 공식 RSS를 기본으로 사용. 더 넓은 언론 검색은 NAVER API HUB 키·약관 확인 후 연결 | 제목·발행처·발행시각·원문 링크만 표시하고 본문·사진을 저장·재노출·Bedrock 입력하지 않음 |

모든 외부 데이터에 source_id, source_url, observed_at, published_at, fetched_at, provider_mode, freshness_status, license_status, redistribution_allowed, ai_use_allowed를 저장한다. 소스가 지연되거나 실패하면 마지막 정상값과 “지연됨” 배지를 표시하며, 오늘 수집한 값을 오늘 관측값인 것처럼 사용하지 않는다.

---

## 7. 목업 데이터 설계

### 7-1. 원칙

- 실제 회사명·사업자번호·바이어 주소·B/L을 사용하지 않는다.
- 모든 레코드에 data_provenance = SYNTHETIC을 표시한다.
- 동일 shipment_ref를 기준으로 계획→견적→부킹→실적→정산이 연결된다.
- Invoice/PL 성격의 수량·중량·포장·금액 합계가 서로 맞아야 한다.
- 날짜는 PO·견적→부킹→Cargo Ready/Cut-off→ETD→ETA 순서를 지킨다.
- 실제 KCCI 값을 사용한 경우 MARKET_OBSERVED로 별도 표시하고 출처·기준일을 기록한다.
- 견적을 KCCI에 임의 프리미엄으로 생성했다면 실제 시장분포라고 주장하지 않는다.
- 일부 20ft·LCL·Reefer 사례를 넣어 시스템이 억지 비교하지 않고 UNSUPPORTED 또는 LOW_CONFIDENCE를 내는지 시험한다.

### 7-2. 제공 파일

표준 Excel은 기업설정, 선적계획, 견적 Header, 견적 Charge Line, 과거선적, 실제 KCCI 스냅샷, 코드표, 검증요약으로 구성한다. 사용자가 업로드 전에 필수값, 날짜 순서, 견적 총액 일치 여부를 확인할 수 있도록 수식 기반 검증을 포함한다.

---

## 8. 기능 고도화

### A. 시장 퍼스트 대시보드

- 상단 브리핑에 오늘 신규 공식 소식 수, 마지막 발행시각, 전체 소스 상태 표시
- KPI 4종: USD/KRW, 한국은행 기준금리, 국고채 3년, KCCI 종합지수
- 공식 뉴스 최신순·분야 필터·원문 링크와 48시간 신규 발행 여부 표시
- ECOS 환율 시계열과 기준금리·국고채 금리 그래프
- KCCI 종합 PT와 주요 항로 USD/FEU를 단위별로 분리
- FBX는 수동 검증시각이 있는 공개 Snapshot, SCFI는 숫자 없이 라이선스 상태 표시
- `observedAt`, `publishedAt`, `fetchedAt/verifiedAt`, `providerMode`를 화면에서 구분
- 하단에서 사용자 데이터 → 규칙엔진 → Bedrock 설명의 활성화 조건 안내

**사용자 가치:** 회사 데이터를 준비하기 전에도 오늘의 시장 맥락을 확인하고, 연결 후 어떤 판단이 추가되는지 이해할 수 있다.

### B. 데이터 온보딩과 품질검사

- 필수값·코드·형식·중복 ID 검사
- 날짜와 마감 순서 검사
- 견적 Header 총액과 Charge Line 합계 대사
- 장비·화물·비용범위에 따른 KCCI 비교 가능 여부 표시
- 오류는 BLOCKING, WARNING, INFO로 나누고 행·필드·수정방법을 반환

**사용자 가치:** 분석 전에 데이터가 왜 안 맞는지 바로 수정할 수 있다.

### C. 견적 정규화·비교

- 통화와 과금단위를 선적·컨테이너·FEU 기준으로 정규화
- Ocean Comparable 비용과 Local/Other 비용을 분리
- 같은 선적의 포워더 견적을 총액·해상비·일정·유효기간으로 비교
- 지원 조건이 맞을 때만 KCCI와 비교
- 과거 실적이 있으면 같은 회사·유사항로·같은 비용범위 내에서만 비교

**사용자 가치:** “A가 싸다”가 아니라 “어떤 비용이 왜 다른지”를 협상 근거로 쓸 수 있다.

### D. 선적 결정 카드

각 선적에 다음을 한 화면으로 제공한다.

- 다음 행동: ACCEPT_QUOTE, REQUOTE, MONITOR_UNTIL, MANUAL_REVIEW
- 행동 마감시각과 놓쳤을 때의 영향
- 예산 편차, 시장 비교 편차, 납기 버퍼, 견적 유효기간
- 직접 비교가 가능한 데이터 범위
- 근거 3개 이내와 반대 신호
- HIGH/MEDIUM/LOW 신뢰도 및 낮은 이유
- 사용한 규칙 버전과 데이터 기준시각

### E. 마감·이행 경보

- 견적 유효기간 만료
- Cargo Ready 대비 CY·Document·VGM Cut-off 충돌
- 납기 버퍼 부족
- Booking 미확정
- 수출신고 수리일 입력 시 적재의무기한 임박
- 계획 ETD 대비 실제 출항 지연

### F. 회사 포트폴리오 대시보드

- 7일 내 행동이 필요한 선적
- 예산 초과 노출액
- 마감 임박·데이터 누락 건수
- 항로별 KCCI 주간 변화와 회사의 열린 선적
- 계획 대비 실제 비용·지연 편차

### G. 리포트와 알림

- 선적별 결정 카드: 웹 + 인쇄 가능한 HTML
- 견적 비교표: Excel/CSV 다운로드
- 주간 포트폴리오 브리핑: 웹·이메일
- 긴급 경보: 이메일을 MVP 기본으로 하고 Telegram은 데모 옵션
- 카카오 알림톡: 비즈니스 채널·승인 템플릿·공식 딜러 계약 후 2단계

### H. 근거형 챗봇

- “왜 재견적이야?”, “어느 비용이 시장 비교에서 제외됐어?” 같은 설명 질의
- 구조화된 계산결과와 승인된 근거만 읽음
- 숫자를 새로 계산하거나 부킹을 실행하지 않음
- 답변에 기준시각·출처·데이터 공백을 표시

---

## 9. 의사결정 로직

### 9-1. 판정 순서

1. **Control Gate**: 수출자가 부킹을 통제하는가?
2. **Readiness Gate**: Cargo Ready, ETD 구간, 납기와 필수 마감을 계산할 수 있는가?
3. **Comparability Gate**: 장비·화물·항로·비용범위가 비교 가능한가?
4. **Cost Check**: 예산·복수견적·시장·과거실적 편차
5. **Schedule Check**: ETD/ETA, 환적, 납기 버퍼, 견적 유효기간
6. **Market Context**: KCCI 주간 변화·변동성 및 공식 이벤트
7. **Action Rule**: 다음 행동과 기한
8. **Confidence**: 데이터 완전성·비교범위·최신성으로 신뢰도 결정

### 9-2. 감사 가능한 핵심 지표

| 지표 | 계산 |
|---|---|
| quote_comparable_unit_cost | KCCI와 범위가 맞는 Charge Line 합계 ÷ FEU |
| market_variance_pct | (quote_comparable_unit_cost - KCCI route rate) ÷ KCCI route rate |
| customs_transport_variance_pct | (동일 범위의 견적 총 운송비 - 관세청 월간 권역 평균) ÷ 관세청 월간 권역 평균 |
| budget_variance_pct | (같은 cost_scope의 견적금액 - 목표금액) ÷ 목표금액 |
| quote_validity_days | valid_until - 평가일 |
| departure_readiness_days | planned_etd - cargo_ready_date |
| delivery_buffer_days | required_delivery_date - planned_eta |
| actual_cost_variance_pct | (실제 정산액 - 승인 견적액) ÷ 승인 견적액 |
| arrival_delay_days | actual_arrival - planned_eta |

임계값은 코드에 숨기지 않고 rules 테이블에서 버전·적용일·근거와 함께 관리한다.

### 9-3. 행동 예시

| 조건 예시 | 행동 | 의미 |
|---|---|---|
| 납기 버퍼가 작고 유효한 견적이 예산 내이며 시장이 상승 | ACCEPT_QUOTE | 해당 견적을 결정기한 전 검토·수용 |
| 견적이 예산 또는 비교 가능한 시장 범위를 크게 초과 | REQUOTE | 같은 범위로 1개 이상 추가 견적 요청 |
| 일정 여유가 있고 유효기간도 충분하며 급격한 상승 신호가 없음 | MONITOR_UNTIL | 지정일에 다시 평가하되 마감은 넘기지 않음 |
| 데이터 부족, 수출자 통제권 없음, 화물·비용범위 비교 불가 | MANUAL_REVIEW | 자동 결론을 내지 않고 확인할 질문을 제시 |

위 조건은 파일럿 초기값이다. 실제 사용자 인터뷰와 견적·실적 대사로 조정하기 전에는 업계 표준이라고 표현하지 않는다.

---

## 10. 최종 결과물 예시

### 10-1. 선적 결정 카드

**SHP-2026-0001 / 부산→롱비치 / 40HC × 2**

- 다음 행동: **7월 14일 15:00까지 재견적 1건 요청**
- 이유:
  1. 현재 견적의 Ocean Comparable 금액이 동일 기준 KCCI보다 12.1% 높음
  2. 회사 ORIGIN_ALL_IN 목표보다 8.4% 초과
  3. 납기 버퍼는 6일로 즉시 부킹만 가능한 상태는 아님
- 반대 신호: 최근 2주 KCCI 상승으로 재견적을 오래 기다리면 비용이 더 오를 수 있음
- 신뢰도: MEDIUM
- 커버리지: 부산발 40ft Dry·해상비 비교 가능, 도착지 비용과 선복은 미확인
- 확인할 질문: 환적 여부, Destination Charge 포함 여부, Space Guarantee 여부
- 근거 기준시각: 2026-07-12 09:00 KST

### 10-2. 주간 포트폴리오 브리핑

- 7일 내 결정 필요 4건
- 예산 초과 예상 노출액 USD 8,240
- 마감 충돌 1건, 필수 데이터 누락 2건
- 미서안 KCCI 주간 +15.97%, 해당 항로 열린 선적 2건
- 지난달 실제 정산액은 승인 견적 대비 평균 +4.6%

모든 숫자에서 회사 입력, 실제 시장 관측, 합성 목업을 시각적으로 구분한다.

---

## 11. 보안·신뢰 원칙

- 계정의 tenant_id는 Cognito 토큰에서 서버가 결정하고 클라이언트 입력을 신뢰하지 않는다.
- PostgreSQL Row-Level Security와 모든 조회의 tenant 조건을 함께 적용한다.
- 업로드 파일은 회사별 S3 Prefix, KMS 암호화, 짧은 만료시간의 Presigned URL을 사용한다.
- 신규 업로드 파일은 검역 구역에 두고 악성코드 검사 후 파싱한다.
- DB·S3·로그에 사업자번호, 개인 연락처, 바이어 주소를 불필요하게 저장하지 않는다.
- B/L·수출신고번호·컨테이너번호는 화면·로그에서 마스킹한다.
- 회사 간 비교 벤치마크는 명시적 동의와 익명화 기준이 마련되기 전까지 제공하지 않는다.
- 모든 권고에 입력 스냅샷, 규칙 버전, 생성시각, 근거 URL을 남긴다.
- 사용자가 데이터를 내보내고 삭제·보존기간을 설정할 수 있게 한다.

---

## 12. 단계별 구현 범위

### MVP-0 — 데이터와 결정 로직 데모

- 시장 퍼스트 대시보드와 버전이 있는 `/api/dashboard` 계약
- ECOS sample 최근 10건·KCCI 공식 최신표·공식 RSS의 실제 연결과 명시적 폴백
- FBX 수동 검증 Snapshot·SCFI 라이선스 Link-only
- 표준 Excel 업로드와 검증결과
- 선적·견적·Charge Line 저장
- 실제 KCCI 고정 스냅샷 + 명확한 기준일
- 복수견적·예산·일정 비교
- 결정 카드와 포트폴리오 화면
- 이메일 또는 Telegram 데모 알림
- 모든 목업에 SYNTHETIC 표시

#### 2026-07-13 로컬 웹 MVP 구현 상태

- `portpulse-mvp/`의 첫 화면을 시장 중심 반응형 대시보드로 재구축
- `/api/dashboard` 계약과 ECOS·KCCI·해양수산부 RSS·관세청 RSS 공급자 어댑터, 소스별 독립 상태 구현
- ECOS USD/KRW·기준금리·국고채 3년 실제 공식 sample 최근 10건과 그래프 구현. 운영키 입력 시 90일로 확장
- KOBC KCCI 공식 최신표 14개 코드를 검증해 표시하고, 정확히 완전하지 않으면 내장 검증 Snapshot으로 전환
- 최근 48시간 내 새 관련 공식 뉴스가 없으면 `새 발행 없음`으로 표시
- Freightos FBX 2026-07-13 수동 검증 Current Snapshot과 Terminal 크레딧, SCFI 숫자 비표시·약관 링크 구현
- 오늘의 결정 큐, 선적 목록·상세, 신규 선적 Wizard, 복수견적 Charge Line 비교 구현
- 기존 `/api/market`의 Frankfurter 경로는 보조 화면 호환용이며 첫 화면 기준 계약은 `/api/dashboard`로 전환
- 표준 XLSX/CSV 브라우저 파싱, BLOCKING·WARNING·INFO 검증, 매핑 미리보기와 승인 구현
- 결정 로그 CSV, 인쇄 가능한 주간 브리핑, 인앱 알림 처리 구현
- 규칙엔진 결과만 설명하는 근거형 챗봇 API 구현. 부킹 실행·데이터 수정·미래 운임 보장은 금지
- 로컬 MVP에서는 서버 저장과 악성코드 검사를 하지 않는다. 운영 전환 시 아래 AWS 아키텍처의 Quarantine·GuardDuty·Staging·Aurora 흐름으로 교체

### MVP-1 — 운영 가능한 자동화

- EventBridge + Lambda로 ECOS 영업일, KCCI 월요일 발표 후, 공식 RSS 10~30분 수집
- S3 Raw Snapshot과 last-known-good 저장소
- ECOS 운영 인증키·Secrets Manager 연결
- FBX 승인 API/PO 또는 수동 Snapshot 운영절차
- 데이터 최신성·실패·재처리 관리
- 부킹·마감·실적·정산 입력
- Bedrock 단일 모델의 근거형 설명
- 이메일 브리핑과 알림 이력

### 2단계 — 제휴·승인이 필요한 기능

- Invoice·Packing List·견적서 필드 추출 후 사용자 매핑
- ChainPortal/Port-i, UNI-PASS 자사 이행정보 연동
- 포워더·선사 스케줄과 Track & Trace API
- 카카오 알림톡
- 충분한 실제 라벨이 누적된 뒤에만 예측모델 검토

---

## 13. 실제 사용성 검증 계획

문서와 목업만으로 “실제로 쓰인다”고 결론 내리지 않는다. 다음 파일럿을 통과해야 한다.

### 인터뷰 대상

- 부산·경남 수출 제조 중소기업 물류·무역 담당자 5~8명
- 포워더 견적 담당자 2~3명
- 가능하면 관세사 또는 무역실무 전문가 1명

### 검증 과제

1. 최근 실제 선적 한 건을 익명화해 10분 안에 입력 가능한가?
2. 포워더 견적에서 Charge Line을 구분할 수 있는가?
3. 실제로 기다릴 수 있었던 건과 없었던 건을 규칙이 구분하는가?
4. 결정 카드의 행동과 근거가 담당자의 판단을 바꾸거나 확인시간을 줄이는가?
5. 어떤 데이터는 제공 가능하고 어떤 데이터는 영업기밀이라 거부하는가?

### MVP 성공 기준

- 타깃 선적의 70% 이상이 치명적 오류 없이 입력 완료
- 신규 선적+견적 등록 중앙값 10분 이내
- 지원대상 40ft Dry 건의 80% 이상에서 비용범위 대사가 가능
- 사용자가 권고 이유와 비교 제외 항목을 설명할 수 있음
- 잘못된 직접 비교 0건
- 알림 이후 재견적·조건확인·마감조치 중 하나가 실제 발생한 사례 확보

---

## 14. 핵심 리스크와 대응

| 리스크 | 대응 |
|---|---|
| KCCI 공식 화면 구조 변경·수집 실패 | 공공데이터 이용범위는 제한 없음. 정확히 14개 코드 검증, 원문 Snapshot 보존, 실패 시 last-known-good와 stale 표시 |
| FBX 최신성·사용조건 | 공개 Current 값은 Freightos 크레딧·Terminal 링크와 수동 검증시각을 표시. 자동수집·이력·AI 사용은 승인 전 금지 |
| SCFI 라이선스 | 비상업 목적도 재배포 허용으로 간주하지 않고 숫자 비표시. 별도 서면 배포권 확보 후 옵션 |
| 공식 RSS 당일 발행 부재 | 연결 성공과 최신성을 분리해 48시간 SLA와 `새 발행 없음` 표시. 언론 검색은 NAVER API HUB 계약 후 추가 |
| 포워더 견적 양식이 제각각 | 표준 Excel 우선, 문서추출은 매핑 미리보기와 사용자 확정 |
| 미래 스케줄·선복 부재 | 견적·Booking Confirmation 입력, 제휴 전에는 unknown 표시 |
| 추천이 과도하게 단정적 | 네 가지 행동, 신뢰도, 반대 신호, 비교 불가 사유 제공 |
| 회사가 실제 비용을 제공하지 않음 | 계획·견적만으로 시작하고 정산 업로드는 선택 |
| LLM 환각 | 숫자 판정은 규칙엔진, LLM 입력은 계산 완료 JSON, 응답에 근거·기준시각 강제 |
| 비용·구축 복잡도 | SageMaker·멀티에이전트·OpenSearch를 MVP에서 제외 |

---

## 15. 주요 근거

### 수출 실무·입력 필드

- 국가법령정보센터, 현행 「수출 및 반송통관에 관한 고시」: https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000270440
- 수출신고서 작성요령 별표: https://www.law.go.kr/LSW/flDownload.do?bylClsCd=200201&flNm=%5B%EB%B3%84%ED%91%9C%5D+%EC%88%98%EC%B6%9C%EC%8B%A0%EA%B3%A0%EC%84%9C+%EC%9E%91%EC%84%B1%EC%9A%94%EB%A0%B9&flSeq=139997973
- 한국무역협회 상업송장 안내: https://www.kita.net/board/format/formatDetail.do?postIndex=1720212
- 한국무역협회 포장명세서 안내·양식: https://www.kita.net/board/format/formatDetail.do?postIndex=1863940
- DCSA Booking 표준: https://dcsa.org/standards/booking
- DCSA Track & Trace 표준: https://dcsa.org/standards/track-and-trace
- UN/LOCODE: https://unece.org/trade/cefact/UNLOCODE-Download

### 문제정의

- 2026 부산 수출기업 조사: https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?no=101682&siteId=1
- 2026 수출물류 애로 접수 분석: https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?no=100225&siteId=1
- 2026 수출기업 경영환경 조사: https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?no=98477&siteId=1
- 2025 미 관세 대응 중소기업 조사: https://www.mss.go.kr/common/board/Download.do?bcIdx=1058901&cbIdx=30&streFileNm=940335f9-e5c6-4f66-bc7f-da55fcc3efb7.pdf
- 2024 홍해사태 수출입기업 조사: https://www.kita.net/board/totalTradeNews/totalTradeNewsDetail.do?logGb=A9400_20240201&no=81612&siteId=1

### 데이터

- KOBC KCCI 최신·시계열: https://www.kobc.or.kr/ebz/shippinginfo/kcci/gridList.do?mId=0304000000
- KOBC KCCI 구성·범위 공공데이터 설명: https://www.data.go.kr/data/15131881/fileData.do
- 한국은행 ECOS Open API: https://ecos.bok.or.kr/api/
- Freightos FBX Global 공식 페이지: https://www.freightos.com/enterprise/terminal/freightos-baltic-index-global-container-pricing-index/
- Freightos Data Terms: https://www.freightos.com/freightos-data-terms-conditions/
- SCFI 이용·구독 FAQ: https://en.sse.net.cn/indices/fqaennew.jsp
- SCFI 이용약관: https://en.sse.net.cn/indices/agreetext.htm
- 해양수산부 보도자료 RSS: https://www.mof.go.kr/doc/ko/rssFeed.do?bbsSeq=10
- 관세청 보도자료 RSS: https://www.customs.go.kr/kcs/selectBoardRss.do?bbsId=1362&mi=2891
- NAVER API HUB 뉴스검색: https://api.ncloud-docs.com/docs/naver-api-hub-search-news
- 관세청 2026년 5월 해상 수출 운송비: https://www.customs.go.kr/kcs/na/ntt/selectNttInfo.do?bbsId=1362&mi=2891&nttSn=10166825&nttSnUrl=7165f29308d85363e87120ca30b47f4c
- 관세청 국가별 해상 수출 운송비 데이터: https://www.data.go.kr/data/15116850/fileData.do
- 관세청 품목별 수출입실적 API: https://www.data.go.kr/data/15101609/openapi.do
- 관세청 수출이행내역 API: https://www.data.go.kr/data/15126269/openapi.do
- 해양수산부 항만별 선박입출항실적 API: https://www.data.go.kr/data/15059059/openapi.do
- BPA ChainPortal 사용자·Open API 신청 매뉴얼: https://chainportal.co.kr/manual/download?filename=Chainportal-TIS-Manual.pdf

---

*PortPulse — 시장을 맞히는 서비스가 아니라, 수출기업이 다음 행동을 더 빨리·근거 있게 결정하도록 돕는 서비스*
