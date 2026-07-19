// PortPulse Bedrock Agent 인프라.
// 직접 Converse 호출(고정 컨텍스트 조립)과 달리, 에이전트는 질문을 보고 필요한 도구만 골라 호출한다
// — 매 요청마다 시장·뉴스·포트폴리오 전체를 프롬프트에 욱여넣던 chat.mjs 방식의 재구성(다음단계 4번).
// 구성: 도구 Lambda(agent-tools.mjs) + CfnAgent(지침·액션그룹 함수 스키마) + 별칭(live) + IAM.
// 도구 스키마는 lambda/agent-tools.mjs의 TOOLS 디스패치와 1:1로 맞춰야 한다(문서: docs/bedrock-agent.md).
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { CfnAgent, CfnAgentAlias } from "aws-cdk-lib/aws-bedrock";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

// 에이전트 지침 — 도구 사용 원칙과 응답 규칙의 단일 원본(SSOT).
// 기존 chat.mjs 시스템 프롬프트의 "데이터 근거·창작 금지" 원칙을 도구 호출 규칙으로 옮긴 것.
export const AGENT_INSTRUCTION = `당신은 PortPulse(한국 수출기업용 해운·물류 대시보드)의 AI 어시스턴트다.
사용자는 해운 운임·환율·금리·선적 의사결정을 다루는 실무자다. 항상 한국어로, 마크다운 기호 없이 짧고 실무적으로 답한다.

[수행 임무]
1. 챗봇: 시장(환율·기준금리·KCCI 컨테이너 운임지수)·해운 뉴스·선적 현황 질문에 답한다.
2. 선적 어드바이저: 요청에 규칙엔진이 계산한 "결정 카드"가 포함되면, 카드의 행동·숫자는 절대 바꾸지 않고
   왜 그 행동인지 데이터로 풀어 설명하고 실무자가 오늘 할 구체 행동(누구에게 무엇을 언제까지)을 제안한다.

[도구 사용 원칙]
- 환율·기준금리·KCCI 수치가 필요하면 반드시 get_market_snapshot(오늘 값·전기 대비 변동) 또는
  get_market_series(기간 추세)를 호출해 얻는다. 기억이나 추정으로 수치를 말하지 않는다.
- 해운 뉴스는 get_top_news, 선적 포트폴리오 현황은 get_shipment_decisions,
  회사의 이번 선적 정보는 get_current_shipment, 최신 AI 선적 추천 결과는 get_latest_recommendation을 쓴다.
- 내부 데이터에 없는 정보(SCFI, 국제유가, 글로벌 해운 이슈, 특정 항만 상황 등)가 필요할 때만 web_search로 보완한다.
  검색 결과를 인용하면 출처(사이트명)를 밝힌다. 도구가 "웹 검색 미설정"을 반환하면 그 사실을 안내하고 내부 데이터만으로 답한다.
- 도구 결과에 없는 수치(미래 운임, 정확한 ETA 등)는 절대 만들어내지 않는다. 도구가 데이터를 못 찾으면 모른다고 답한다.

[응답 규칙]
- 수치를 인용할 땐 기준일을 함께 적는다. 예: 원/달러 1,504.9원(2026-07-14 기준).
- 판단·추천이 담긴 답변의 마지막에는 "※ AI 참고 의견이며 최종 판단은 담당자 확인이 필요합니다." 한 줄을 붙인다.
- 회사의 실제 계약서·사내 문서는 아직 연결돼 있지 않다 — 회사 고유 정보를 물으면 이 점을 안내한다.
- get_shipment_decisions의 포트폴리오는 가상 샘플(데모)이다 — 필요 시 그 사실을 밝힌다.`;

// 액션그룹 함수 스키마 — agent-tools.mjs 디스패치와 1:1.
const ACTION_GROUPS = (toolsArn) => [
  {
    actionGroupName: "market-data",
    description: "DynamoDB 시장 시계열(환율·기준금리·KCCI 13개 항로) 조회",
    actionGroupExecutor: { lambda: toolsArn },
    functionSchema: {
      functions: [
        {
          name: "get_market_snapshot",
          description: "오늘의 시장 스냅샷: 환율 4종(달러/엔/유로/위안)·한국은행 기준금리·KCCI 종합지수의 최신값과 전기 대비 변동, 주간 ±3% 이상 급등락 항로 목록.",
        },
        {
          name: "get_market_series",
          description: "특정 지표의 최근 N일 시계열(추세 질문용). seriesId 예: FX_USD_KRW, BOK_BASE_RATE, KCCI(종합), KUWI(북미서안) 등. 알 수 없는 id를 주면 사용 가능한 전체 목록을 돌려준다.",
          parameters: {
            seriesId: { type: "string", description: "지표 id (FX_USD_KRW / FX_JPY_KRW / FX_EUR_KRW / FX_CNY_KRW / BOK_BASE_RATE / KCCI / 항로코드)", required: true },
            days: { type: "integer", description: "조회 기간(일). 기본 90, 최대 3650. 200포인트 초과 시 균등 샘플링됨.", required: false },
          },
        },
      ],
    },
  },
  {
    actionGroupName: "news-data",
    description: "수집된 해운·물류 뉴스(키워드 점수 상위) 조회",
    actionGroupExecutor: { lambda: toolsArn },
    functionSchema: {
      functions: [
        {
          name: "get_top_news",
          description: "해당 날짜(기본 오늘, KST)의 해운·물류 뉴스 상위 N건(제목·매체·발행시각·링크). 중복 기사는 제거돼 있음.",
          parameters: {
            date: { type: "string", description: "YYYY-MM-DD (생략 시 오늘)", required: false },
            limit: { type: "integer", description: "건수. 기본 5, 최대 20", required: false },
          },
        },
      ],
    },
  },
  {
    actionGroupName: "company-data",
    description: "회사 선적·결정카드·AI 추천 이력 조회",
    actionGroupExecutor: { lambda: toolsArn },
    functionSchema: {
      functions: [
        {
          name: "get_shipment_decisions",
          description: "샘플 선적 포트폴리오 6건의 결정카드(규칙엔진 확정: 행동·우선순위·마감·예산/KCCI 편차·근거). 가상 데모 데이터.",
        },
        {
          name: "get_current_shipment",
          description: "회사가 입력한 '이번 선적' 정보(구간·화물·납기·예산)와 회사 정책. 출처는 UI폼 > 업로드 엑셀 > 번들 샘플 순.",
        },
        {
          name: "get_latest_recommendation",
          description: "가장 최근 저장된 AI 선적 추천(stance·verdict·요약·권고 행동). '지금 예약해야 하나' 류 질문에 사용.",
        },
      ],
    },
  },
  {
    actionGroupName: "web-search",
    description: "내부 DB에 없는 최신 정보 웹 검색(Tavily)",
    actionGroupExecutor: { lambda: toolsArn },
    functionSchema: {
      functions: [
        {
          name: "web_search",
          description: "웹 검색. 내부 도구로 답할 수 없는 최신·글로벌 정보(SCFI, 유가, 해외 항만 이슈 등)에만 사용.",
          parameters: {
            query: { type: "string", description: "검색어", required: true },
            maxResults: { type: "integer", description: "결과 수. 기본 5, 최대 8", required: false },
          },
        },
      ],
    },
  },
];

export class PortpulseAgent extends Construct {
  constructor(scope, id, { lambdaDir, marketTable, newsTable, recoTable, companyBucket, companyKey, modelId, guardrail, knowledgeBase }) {
    super(scope, id);
    const stack = Stack.of(this);

    // 웹 검색 API 키(Tavily). 텔레그램과 동일 패턴 — 배포 후 put-secret-value로 채우고, 없으면 도구가 안내만 반환.
    const webSearchSecret = new Secret(this, "WebSearchSecret", {
      secretName: "portpulse/web-search",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const toolsFn = new LambdaFunction(this, "AgentTools", {
      functionName: "portpulse-agent-tools",
      runtime: Runtime.NODEJS_22_X,
      handler: "agent-tools.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(30),
      memorySize: 512,
      logGroup: new LogGroup(this, "AgentToolsLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        MARKET_TABLE_NAME: marketTable.tableName,
        NEWS_TABLE_NAME: newsTable.tableName,
        RECO_TABLE_NAME: recoTable.tableName,
        COMPANY_BUCKET: companyBucket.bucketName,
        COMPANY_KEY: companyKey,
        WEB_SEARCH_SECRET_NAME: webSearchSecret.secretName,
      },
    });
    marketTable.grantReadData(toolsFn);
    newsTable.grantReadData(toolsFn);
    recoTable.grantReadData(toolsFn);
    companyBucket.grantRead(toolsFn); // 현재 선적/엑셀 읽기(get_current_shipment)
    webSearchSecret.grantRead(toolsFn);

    // 에이전트 서비스 롤 — Bedrock이 이 롤로 기반 모델을 호출한다.
    // 모델 ARN 형태(inference-profile vs foundation-model)가 리전마다 달라 기존 Lambda들과 동일하게
    // 우선 전체 허용, 실호출 확인 후 좁힌다(market-stack.mjs의 기존 주석과 같은 이유).
    const agentRole = new Role(this, "AgentRole", {
      roleName: `portpulse-bedrock-agent-role-${stack.region}`,
      assumedBy: new ServicePrincipal("bedrock.amazonaws.com"),
    });
    agentRole.addToPolicy(new PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:GetInferenceProfile"],
      resources: ["*"],
    }));
    if (guardrail) {
      agentRole.addToPolicy(new PolicyStatement({
        actions: ["bedrock:ApplyGuardrail"],
        resources: ["*"],
      }));
    }
    if (knowledgeBase) {
      agentRole.addToPolicy(new PolicyStatement({
        actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
        resources: ["*"],
      }));
    }

    const agent = new CfnAgent(this, "Agent", {
      agentName: "portpulse-agent",
      agentResourceRoleArn: agentRole.roleArn,
      // 크로스리전 추론 프로필 ID(기존 Lambda들과 동일 모델). CreateAgent가 이 ID를 거부하면
      // arn:aws:bedrock:{region}:{account}:inference-profile/{id} 형태의 ARN으로 바꿔 넣을 것.
      foundationModel: modelId,
      instruction: AGENT_INSTRUCTION,
      actionGroups: ACTION_GROUPS(toolsFn.functionArn),
      autoPrepare: true, // 스키마·지침 변경 배포 시 자동 재준비(PREPARED) — 수동 콘솔 작업 제거
      idleSessionTtlInSeconds: 900, // 삭제 전 관측값과 동일(2026-07-19 사고기록 참조)
      description: "PortPulse 해운·물류 어시스턴트 — 시장/뉴스/선적 DB 도구 + 웹 검색",
      guardrailConfiguration: guardrail
        ? { guardrailIdentifier: guardrail.guardrailId, guardrailVersion: guardrail.guardrailVersion }
        : undefined,
      knowledgeBases: knowledgeBase
        ? [{ knowledgeBaseId: knowledgeBase.knowledgeBaseId, description: "PortPulse 해운 도메인 문서 RAG", knowledgeBaseState: "ENABLED" }]
        : undefined,
    });
    agent.node.addDependency(agentRole);

    // 도구 Lambda를 Bedrock(이 에이전트)만 부를 수 있게 리소스 정책으로 제한.
    toolsFn.addPermission("BedrockAgentInvoke", {
      principal: new ServicePrincipal("bedrock.amazonaws.com"),
      sourceArn: agent.attrAgentArn,
    });

    // 호출용 별칭 — 코드(chat 등)는 항상 이 별칭을 부른다(TSTALIASID 같은 드래프트 직접 호출 금지).
    const alias = new CfnAgentAlias(this, "AgentAlias", {
      agentAliasName: "live",
      agentId: agent.attrAgentId,
    });

    this.agent = agent;
    this.agentId = agent.attrAgentId;
    this.aliasId = alias.attrAgentAliasId;
    this.aliasArn = alias.attrAgentAliasArn;
    this.toolsFunction = toolsFn;
  }

  // 호출측 Lambda(chat/advisor)에 에이전트 접근 권한+환경변수를 붙인다.
  grantInvoke(fn) {
    fn.addEnvironment("AGENT_ID", this.agentId);
    fn.addEnvironment("AGENT_ALIAS_ID", this.aliasId);
    fn.addToRolePolicy(new PolicyStatement({
      actions: ["bedrock:InvokeAgent"],
      resources: [this.aliasArn],
    }));
  }
}
