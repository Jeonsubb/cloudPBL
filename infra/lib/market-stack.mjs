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
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: new LogGroup(this, "NewsCollectorLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: { NEWS_TABLE_NAME: newsTable.tableName },
    });
    newsTable.grantWriteData(newsCollector);

    // 3시간마다: 각 피드가 4~6일치를 담고 있어 한 번 놓쳐도 안전한 여유가 있다.
    new Rule(this, "NewsCollectRule", {
      schedule: Schedule.rate(Duration.hours(3)),
      targets: [new LambdaTarget(newsCollector)],
    });

    const newsQueryFn = new LambdaFunction(this, "NewsQuery", {
      functionName: "portpulse-news-query",
      runtime: Runtime.NODEJS_22_X,
      handler: "news-query.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(10),
      memorySize: 256,
      logGroup: new LogGroup(this, "NewsQueryLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: { NEWS_TABLE_NAME: newsTable.tableName },
    });
    newsTable.grantReadData(newsQueryFn);

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

    const queryFn = new LambdaFunction(this, "MarketQuery", {
      functionName: "portpulse-market-query",
      runtime: Runtime.NODEJS_22_X,
      handler: "query.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(10),
      memorySize: 256,
      logGroup: new LogGroup(this, "MarketQueryLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: { TABLE_NAME: table.tableName },
    });
    table.grantReadData(queryFn);

    const httpApi = new HttpApi(this, "MarketApi", {
      apiName: "portpulse-market-api",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.GET],
        allowHeaders: ["content-type"],
      },
    });
    const integration = new HttpLambdaIntegration("MarketQueryIntegration", queryFn);
    httpApi.addRoutes({ path: "/series", methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({ path: "/series/{seriesId}", methods: [HttpMethod.GET], integration });

    const newsIntegration = new HttpLambdaIntegration("NewsQueryIntegration", newsQueryFn);
    httpApi.addRoutes({ path: "/news/top", methods: [HttpMethod.GET], integration: newsIntegration });

    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "NewsTableName", { value: newsTable.tableName });
    new CfnOutput(this, "CollectorName", { value: collector.functionName });
    new CfnOutput(this, "KcciCollectorName", { value: kcciCollector.functionName });
    new CfnOutput(this, "NewsCollectorName", { value: newsCollector.functionName });
    new CfnOutput(this, "NewsDigestName", { value: newsDigest.functionName });
    new CfnOutput(this, "TelegramSecretName", { value: telegramSecret.secretName });
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
  }
}
