import { Stack, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Bucket, BlockPublicAccess, HttpMethods } from "aws-cdk-lib/aws-s3";
import { fileURLToPath } from "node:url";

const lambdaDir = fileURLToPath(new URL("../../lambda", import.meta.url));

export class MarketStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const table = new Table(this, "MarketTimeseries", {
      tableName: "portpulse-market-timeseries",
      partitionKey: { name: "series", type: AttributeType.STRING },
      sortKey: { name: "date", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // 개발 스택: 스택 삭제 시 테이블도 삭제. 운영 전환 시 RETAIN으로 변경할 것.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const collector = new LambdaFunction(this, "EcosCollector", {
      functionName: "portpulse-ecos-collector",
      runtime: Runtime.NODEJS_22_X,
      handler: "collector.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.minutes(2),
      memorySize: 256,
      logGroup: new LogGroup(this, "EcosCollectorLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        TABLE_NAME: table.tableName,
        ECOS_API_KEY: process.env.ECOS_API_KEY ?? "sample",
        DEFAULT_DAYS: "14",
      },
    });
    table.grantWriteData(collector);

    // 매일 18:10 KST(09:10 UTC): ECOS 일별 지표(환율 매매기준율 등) 당일 고시 반영 이후 시점.
    new Rule(this, "DailyCollect", {
      schedule: Schedule.cron({ minute: "10", hour: "9" }),
      targets: [new LambdaTarget(collector, { event: RuleTargetInput.fromObject({ days: 14 }) })],
    });

    const kcciCollector = new LambdaFunction(this, "KcciCollector", {
      functionName: "portpulse-kcci-collector",
      runtime: Runtime.NODEJS_22_X,
      handler: "kcci-collector.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.minutes(2),
      memorySize: 256,
      logGroup: new LogGroup(this, "KcciCollectorLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: { TABLE_NAME: table.tableName, DEFAULT_WEEKS: "4" },
    });
    table.grantWriteData(kcciCollector);

    // 매주 월요일 15:00 KST(06:00 UTC): KCCI는 월요일 14시 발표 이후 1시간 여유.
    new Rule(this, "WeeklyKcciCollect", {
      schedule: Schedule.cron({ minute: "0", hour: "6", weekDay: "MON" }),
      targets: [new LambdaTarget(kcciCollector, { event: RuleTargetInput.fromObject({ weeks: 4 }) })],
    });

    const newsTable = new Table(this, "NewsTable", {
      tableName: "portpulse-news",
      partitionKey: { name: "date", type: AttributeType.STRING },
      sortKey: { name: "articleId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const newsCollector = new LambdaFunction(this, "NewsCollector", {
      functionName: "portpulse-news-collector",
      runtime: Runtime.NODEJS_22_X,
      handler: "news-collector.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(90),
      memorySize: 256,
      logGroup: new LogGroup(this, "NewsCollectorLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        NEWS_TABLE_NAME: newsTable.tableName,
        BEDROCK_MODEL_ID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
      },
    });
    // Query(읽기)까지 필요 — 수집 후 최근 뉴스를 다시 읽어 Bedrock 중복제거에 넘긴다.
    newsTable.grantReadWriteData(newsCollector);
    newsCollector.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );

    // 3시간마다: 각 피드가 4~6일치를 담고 있어 한 번 놓쳐도 안전한 여유가 있다.
    new Rule(this, "NewsCollectRule", {
      schedule: Schedule.rate(Duration.hours(3)),
      targets: [new LambdaTarget(newsCollector)],
    });

    // 텔레그램 봇 토큰/chatId. 배포 후 aws secretsmanager put-secret-value로 직접 채워 넣을 것 — CDK에는 넣지 않는다.
    const telegramSecret = new Secret(this, "TelegramSecret", {
      secretName: "portpulse/telegram-bot",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const newsDigest = new LambdaFunction(this, "NewsDigest", {
      functionName: "portpulse-news-digest",
      runtime: Runtime.NODEJS_22_X,
      handler: "news-digest.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(60),
      memorySize: 256,
      logGroup: new LogGroup(this, "NewsDigestLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        NEWS_TABLE_NAME: newsTable.tableName,
        MARKET_TABLE_NAME: table.tableName,
        TELEGRAM_SECRET_NAME: telegramSecret.secretName,
        BEDROCK_MODEL_ID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
      },
    });
    newsTable.grantReadData(newsDigest);
    table.grantReadData(newsDigest);
    telegramSecret.grantRead(newsDigest);
    // 모델 ARN 형태(foundation-model vs inference-profile)를 아직 확정 못해 우선 전체 허용 —
    // 실제 호출 성공 후 정확한 ARN으로 좁힐 것.
    newsDigest.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );

    // 매일 07:00 KST(22:00 UTC 전날): 프리마켓 전 브리핑.
    new Rule(this, "DailyDigestRule", {
      schedule: Schedule.cron({ minute: "0", hour: "22" }),
      targets: [new LambdaTarget(newsDigest)],
    });

    // 회사 입력 엑셀 업로드 버킷 — 실서비스의 "회사 데이터 받기" 흐름.
    // current/company-input.xlsx 를 최신본으로 덮어쓰면 추천이 그 데이터로 갱신된다.
    // current/current-shipment.json은 UI 폼으로 직접 제출한 "이번 선적" 오버라이드(엑셀 없이도 가능).
    // CORS: 브라우저가 presigned URL로 이 버킷에 직접 PUT 하므로 버킷 자체에 CORS가 필요하다
    // (API Gateway CORS와는 별개 — 프론트→S3 직결 업로드 경로).
    const companyBucket = new Bucket(this, "CompanyUploads", {
      bucketName: `portpulse-company-uploads-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [{
        allowedOrigins: ["*"],
        allowedMethods: [HttpMethods.PUT, HttpMethods.GET],
        allowedHeaders: ["*"],
        maxAge: 300,
      }],
    });
    const companyKey = "current/company-input.xlsx";

    // 추천 이력 테이블 — 재평가마다 저장. 나중에 "그때 판단이 맞았나" 적중검증 + stance 변화감지 근거.
    const recoTable = new Table(this, "Recommendations", {
      tableName: "portpulse-recommendations",
      partitionKey: { name: "shipmentId", type: AttributeType.STRING },
      sortKey: { name: "evaluatedAt", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // 읽기 전용 조회 + AI 추천 통합: /series · /news/top · /shipments · /recommendations.
    // 넷 다 "API Gateway → (DB/Bedrock) → 응답"인 동일 트리거·패턴이라 한 Lambda로 합쳤다(api.mjs가 경로로 위임).
    // 수집기(Ecos/Kcci/News)는 스케줄·외부 API가 서로 달라 여기 합치지 않고 분리 유지.
    const apiQuery = new LambdaFunction(this, "ApiQuery", {
      functionName: "portpulse-api-query",
      runtime: Runtime.NODEJS_22_X,
      handler: "api.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(60),
      memorySize: 512,
      logGroup: new LogGroup(this, "ApiQueryLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        MARKET_TABLE_NAME: table.tableName,
        NEWS_TABLE_NAME: newsTable.tableName,
        RECO_TABLE_NAME: recoTable.tableName,
        COMPANY_BUCKET: companyBucket.bucketName,
        COMPANY_KEY: companyKey,
        BEDROCK_MODEL_ID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
      },
    });
    table.grantReadData(apiQuery);
    newsTable.grantReadData(apiQuery);
    recoTable.grantReadWriteData(apiQuery);
    companyBucket.grantReadWrite(apiQuery); // presigned PUT 발급 + /shipments/current 직접 저장
    apiQuery.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );

    // 추천 재평가 모니터 — 매일 현재 선적을 다시 평가해 stance가 바뀌면 텔레그램 알림.
    const recoMonitor = new LambdaFunction(this, "RecoMonitor", {
      functionName: "portpulse-reco-monitor",
      runtime: Runtime.NODEJS_22_X,
      handler: "recommend-monitor.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(60),
      memorySize: 512,
      logGroup: new LogGroup(this, "RecoMonitorLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        MARKET_TABLE_NAME: table.tableName,
        NEWS_TABLE_NAME: newsTable.tableName,
        RECO_TABLE_NAME: recoTable.tableName,
        COMPANY_BUCKET: companyBucket.bucketName,
        COMPANY_KEY: companyKey,
        TELEGRAM_SECRET_NAME: telegramSecret.secretName,
        BEDROCK_MODEL_ID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
      },
    });
    table.grantReadData(recoMonitor);
    newsTable.grantReadData(recoMonitor);
    recoTable.grantReadWriteData(recoMonitor);
    companyBucket.grantRead(recoMonitor);
    telegramSecret.grantRead(recoMonitor);
    recoMonitor.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );
    // 매일 07:30 KST(22:30 UTC 전날) — 뉴스 브리핑(07:00) 직후, 프리마켓 전 재평가.
    new Rule(this, "DailyRecoReview", {
      schedule: Schedule.cron({ minute: "30", hour: "22" }),
      targets: [new LambdaTarget(recoMonitor)],
    });

    // 플로팅 챗봇(오른쪽 하단) — 시장 스냅샷 + 뉴스 + 샘플 포트폴리오를 컨텍스트로 답변.
    // RAG/회사 문서 연동은 다음 단계(현재는 대시보드에 이미 있는 데이터만 근거로 삼음).
    const chatFn = new LambdaFunction(this, "ChatBot", {
      functionName: "portpulse-chat",
      runtime: Runtime.NODEJS_22_X,
      handler: "chat.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(60),
      memorySize: 256,
      logGroup: new LogGroup(this, "ChatBotLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        MARKET_TABLE_NAME: table.tableName,
        NEWS_TABLE_NAME: newsTable.tableName,
        BEDROCK_MODEL_ID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
      },
    });
    table.grantReadData(chatFn);
    newsTable.grantReadData(chatFn);
    chatFn.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );

    const httpApi = new HttpApi(this, "MarketApi", {
      apiName: "portpulse-market-api",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
        allowHeaders: ["content-type"],
      },
    });
    const apiIntegration = new HttpLambdaIntegration("ApiQueryIntegration", apiQuery);
    httpApi.addRoutes({ path: "/series", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/series/{seriesId}", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/news/top", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/shipments", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/shipments/{shipmentId}/advisor", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/recommendations", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/recommendations/{shipmentId}", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/company/upload-url", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/company/status", methods: [HttpMethod.GET], integration: apiIntegration });
    httpApi.addRoutes({ path: "/shipments/current", methods: [HttpMethod.GET, HttpMethod.POST], integration: apiIntegration });

    const chatIntegration = new HttpLambdaIntegration("ChatBotIntegration", chatFn);
    httpApi.addRoutes({ path: "/chat", methods: [HttpMethod.POST], integration: chatIntegration });

    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "NewsTableName", { value: newsTable.tableName });
    new CfnOutput(this, "CollectorName", { value: collector.functionName });
    new CfnOutput(this, "KcciCollectorName", { value: kcciCollector.functionName });
    new CfnOutput(this, "NewsCollectorName", { value: newsCollector.functionName });
    new CfnOutput(this, "NewsDigestName", { value: newsDigest.functionName });
    new CfnOutput(this, "TelegramSecretName", { value: telegramSecret.secretName });
    new CfnOutput(this, "ApiQueryName", { value: apiQuery.functionName });
    new CfnOutput(this, "ChatBotName", { value: chatFn.functionName });
    new CfnOutput(this, "CompanyBucketName", { value: companyBucket.bucketName });
    new CfnOutput(this, "RecoTableName", { value: recoTable.tableName });
    new CfnOutput(this, "RecoMonitorName", { value: recoMonitor.functionName });
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
  }
}
