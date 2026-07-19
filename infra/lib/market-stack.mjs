import { Stack, Duration, RemovalPolicy, CfnOutput, CfnResource } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { Rule, RuleTargetInput, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction as LambdaTarget } from "aws-cdk-lib/aws-events-targets";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CorsHttpMethod, HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Bucket, BlockPublicAccess, HttpMethods } from "aws-cdk-lib/aws-s3";
import { CfnIndex, CfnVectorBucket } from "aws-cdk-lib/aws-s3vectors";
import { fileURLToPath } from "node:url";

const lambdaDir = fileURLToPath(new URL("../../lambda", import.meta.url));
const KB_VECTOR_INDEX_NAME = "portpulse-kb-index";

export class MarketStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // ============================
    // 1. DynamoDB Tables
    // ============================

    const table = new Table(this, "MarketTimeseries", {
      tableName: "portpulse-market-timeseries",
      partitionKey: { name: "series", type: AttributeType.STRING },
      sortKey: { name: "date", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const newsTable = new Table(this, "NewsTable", {
      tableName: "portpulse-news",
      partitionKey: { name: "date", type: AttributeType.STRING },
      sortKey: { name: "articleId", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const recoTable = new Table(this, "Recommendations", {
      tableName: "portpulse-recommendations",
      partitionKey: { name: "shipmentId", type: AttributeType.STRING },
      sortKey: { name: "evaluatedAt", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ============================
    // 2. S3 Buckets
    // ============================

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

    // Knowledge Base 문서 저장 버킷
    const kbBucket = new Bucket(this, "KnowledgeBaseBucket", {
      bucketName: `portpulse-knowledge-base-${this.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // S3 Vectors는 원본 문서 버킷과 별개인 전용 vector bucket/index다.
    // Titan Text Embeddings V2 기본 출력과 같은 1024차원을 사용한다.
    const kbVectorBucket = new CfnVectorBucket(this, "KnowledgeBaseVectorBucket", {
      vectorBucketName: `portpulse-kb-vectors-${this.account}`,
      encryptionConfiguration: { sseType: "AES256" },
      tags: [{ key: "Project", value: "PortPulse" }],
    });

    const kbVectorIndex = new CfnIndex(this, "KnowledgeBaseVectorIndex", {
      vectorBucketArn: kbVectorBucket.attrVectorBucketArn,
      indexName: KB_VECTOR_INDEX_NAME,
      dataType: "float32",
      dimension: 1024,
      distanceMetric: "cosine",
      // Bedrock가 저장하는 본문과 시스템 메타데이터는 필터 대상이 아니다.
      // 이 설정이 없으면 ingestion 시 S3 Vectors의 필터 메타데이터 한도를 넘을 수 있다.
      metadataConfiguration: {
        nonFilterableMetadataKeys: [
          "AMAZON_BEDROCK_TEXT",
          "AMAZON_BEDROCK_METADATA",
        ],
      },
      tags: [{ key: "Project", value: "PortPulse" }],
    });

    // ============================
    // 3. Secrets
    // ============================

    const telegramSecret = new Secret(this, "TelegramSecret", {
      secretName: "portpulse/telegram-bot",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ============================
    // 4. Bedrock Agent Infrastructure
    // ============================

    // 4-1. Guardrail
    const guardrail = new CfnResource(this, "ChatGuardrail", {
      type: "AWS::Bedrock::Guardrail",
      properties: {
        Name: "portpulse-chat-guardrail",
        Description: "PortPulse 물류 리스크 상담 입력 및 출력 보호",
        BlockedInputMessaging: "요청하신 내용은 PortPulse 물류 리스크 상담 범위 또는 보안 정책상 처리할 수 없습니다.",
        BlockedOutputsMessaging: "안전하고 검증 가능한 답변을 생성하지 못했습니다. 물류·운임·부킹 관련 질문으로 다시 요청해주세요.",
        ContentPolicyConfig: {
          FiltersConfig: [
            { Type: "PROMPT_ATTACK", InputStrength: "HIGH", OutputStrength: "NONE", InputAction: "BLOCK", OutputAction: "NONE", InputEnabled: true, OutputEnabled: false },
            { Type: "MISCONDUCT", InputStrength: "HIGH", OutputStrength: "HIGH", InputAction: "BLOCK", OutputAction: "BLOCK", InputEnabled: true, OutputEnabled: true },
            { Type: "HATE", InputStrength: "MEDIUM", OutputStrength: "MEDIUM", InputAction: "BLOCK", OutputAction: "BLOCK", InputEnabled: true, OutputEnabled: true },
            { Type: "SEXUAL", InputStrength: "HIGH", OutputStrength: "HIGH", InputAction: "BLOCK", OutputAction: "BLOCK", InputEnabled: true, OutputEnabled: true },
            { Type: "VIOLENCE", InputStrength: "HIGH", OutputStrength: "HIGH", InputAction: "BLOCK", OutputAction: "BLOCK", InputEnabled: true, OutputEnabled: true },
          ],
        },
        TopicPolicyConfig: {
          TopicsConfig: [
            {
              Name: "PersonalInvestmentAdvice",
              Definition: "개인의 투자 수익을 목적으로 주식, 채권, 가상자산 또는 금융상품의 매수, 매도, 보유를 지시하거나 추천하는 조언",
              Examples: ["지금 어떤 주식을 사야 해?", "비트코인에 투자해도 될까?"],
              Type: "DENY",
            },
          ],
        },
        SensitiveInformationPolicyConfig: {
          PiiEntitiesConfig: [
            { Type: "EMAIL", Action: "ANONYMIZE" },
            { Type: "PHONE", Action: "ANONYMIZE" },
            { Type: "CREDIT_DEBIT_CARD_NUMBER", Action: "BLOCK" },
          ],
        },
      },
    });

    const guardrailVersion = new CfnResource(this, "ChatGuardrailVersion", {
      type: "AWS::Bedrock::GuardrailVersion",
      properties: {
        GuardrailIdentifier: guardrail.getAtt("GuardrailId").toString(),
        Description: "PortPulse chat guardrail v1",
      },
    });

    // 4-2. Agent Action Group Lambda
    const agentToolsFn = new LambdaFunction(this, "AgentTools", {
      functionName: "portpulse-agent-tools",
      runtime: Runtime.NODEJS_22_X,
      handler: "agent-tools.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup: new LogGroup(this, "AgentToolsLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        MARKET_TABLE_NAME: table.tableName,
        NEWS_TABLE_NAME: newsTable.tableName,
        RECO_TABLE_NAME: recoTable.tableName,
      },
    });
    // 기존 배포에서는 이 Lambda가 Agent 하위 construct에 있어 논리 ID가 달랐다.
    // 같은 함수 이름을 새 리소스로 만들지 않고 기존 CloudFormation 리소스를 이어서 업데이트한다.
    agentToolsFn.node.defaultChild.overrideLogicalId("PortpulseAgentAgentToolsF8B89BD2");
    table.grantReadData(agentToolsFn);
    newsTable.grantReadData(agentToolsFn);
    recoTable.grantReadData(agentToolsFn);

    // Bedrock Agent가 이 Lambda를 호출할 수 있게 허용
    agentToolsFn.addPermission("BedrockAgentInvoke", {
      principal: new ServicePrincipal("bedrock.amazonaws.com"),
      sourceAccount: this.account,
    });

    // 4-3. Agent IAM Role
    const agentRole = new Role(this, "BedrockAgentRole", {
      roleName: "portpulse-bedrock-agent-role",
      assumedBy: new ServicePrincipal("bedrock.amazonaws.com"),
    });
    agentRole.addToPolicy(new PolicyStatement({
      actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
      resources: ["*"],
    }));
    agentRole.addToPolicy(new PolicyStatement({
      actions: ["bedrock:ApplyGuardrail"],
      resources: [`arn:aws:bedrock:${this.region}:${this.account}:guardrail/*`],
    }));
    agentRole.addToPolicy(new PolicyStatement({
      actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
      resources: [`arn:aws:bedrock:${this.region}:${this.account}:knowledge-base/*`],
    }));

    // 4-4. Knowledge Base IAM Role
    const kbRole = new Role(this, "KnowledgeBaseRole", {
      roleName: "portpulse-bedrock-kb-role",
      assumedBy: new ServicePrincipal("bedrock.amazonaws.com"),
    });
    kbRole.addToPolicy(new PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [`arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`],
    }));
    kbRole.addToPolicy(new PolicyStatement({
      actions: ["s3:GetObject", "s3:ListBucket"],
      resources: [kbBucket.bucketArn, `${kbBucket.bucketArn}/*`],
    }));
    kbRole.addToPolicy(new PolicyStatement({
      actions: [
        "s3vectors:PutVectors",
        "s3vectors:GetVectors",
        "s3vectors:DeleteVectors",
        "s3vectors:QueryVectors",
        "s3vectors:GetIndex",
      ],
      resources: [kbVectorIndex.attrIndexArn],
    }));

    // 4-5. Knowledge Base (L1 CfnResource — CDK L2 not available for Bedrock KB)
    const knowledgeBase = new CfnResource(this, "PortPulseKnowledgeBase", {
      type: "AWS::Bedrock::KnowledgeBase",
      properties: {
        Name: "PortPulse_KnowledgeBase",
        Description: "해운 물류 도메인 지식 (항로, 운임지수, Incoterms, 부킹 판단 기준)",
        RoleArn: kbRole.roleArn,
        KnowledgeBaseConfiguration: {
          Type: "VECTOR",
          VectorKnowledgeBaseConfiguration: {
            EmbeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
          },
        },
        StorageConfiguration: {
          Type: "S3_VECTORS",
          S3VectorsConfiguration: {
            IndexArn: kbVectorIndex.attrIndexArn,
          },
        },
      },
    });
    knowledgeBase.node.addDependency(kbVectorIndex);
    const kbDefaultPolicy = kbRole.node.tryFindChild("DefaultPolicy");
    if (kbDefaultPolicy) knowledgeBase.node.addDependency(kbDefaultPolicy);

    // 4-6. KB Data Source
    const kbDataSource = new CfnResource(this, "KBDataSource", {
      type: "AWS::Bedrock::DataSource",
      properties: {
        Name: "PortPulse_S3_Documents",
        Description: "해운 도메인 문서 S3 데이터 소스",
        KnowledgeBaseId: knowledgeBase.ref,
        DataDeletionPolicy: "RETAIN",
        DataSourceConfiguration: {
          Type: "S3",
          S3Configuration: {
            BucketArn: kbBucket.bucketArn,
            InclusionPrefixes: ["docs/"],
          },
        },
        VectorIngestionConfiguration: {
          ChunkingConfiguration: {
            ChunkingStrategy: "FIXED_SIZE",
            FixedSizeChunkingConfiguration: {
              MaxTokens: 512,
              OverlapPercentage: 20,
            },
          },
        },
      },
    });

    // 4-7. Bedrock Agent
    const agent = new CfnResource(this, "PortPulseAgent", {
      type: "AWS::Bedrock::Agent",
      properties: {
        AgentName: "portpulse-agent",
        Description: "PortPulse 해운 운임·부킹 타이밍 상담 AI Agent",
        AgentResourceRoleArn: agentRole.roleArn,
        FoundationModel: "anthropic.claude-sonnet-4-20250514-v1:0",
        AutoPrepare: true,
        IdleSessionTTLInSeconds: 900,
        GuardrailConfiguration: {
          GuardrailIdentifier: guardrail.getAtt("GuardrailId").toString(),
          GuardrailVersion: guardrailVersion.getAtt("Version").toString(),
        },
        KnowledgeBases: [{
          KnowledgeBaseId: knowledgeBase.ref,
          Description: "해운 항로, 운임지수 해석, Incoterms, 부킹 판단 기준에 관한 도메인 문서를 검색합니다.",
          KnowledgeBaseState: "ENABLED",
        }],
        ActionGroups: [{
          ActionGroupName: "PortPulseTools",
          Description: "시장 데이터, 뉴스, 선적 리스크 조회 도구",
          ActionGroupState: "ENABLED",
          ActionGroupExecutor: { Lambda: agentToolsFn.functionArn },
          FunctionSchema: {
            Functions: [
              {
                Name: "GetMarketSnapshot",
                Description: "최신 KCCI 운임지수, 원달러 환율, 기준금리, 주간 급등락 항로를 조회합니다.",
                Parameters: {
                  route: { Description: "조회할 KCCI 항로 코드 (예: KUWI, KNEI). 미지정 시 종합지수만 반환.", Type: "string", Required: false },
                },
              },
              {
                Name: "GetHighImpactNews",
                Description: "최근 수집된 해운 뉴스 중 중요도 상위 N건을 조회합니다.",
                Parameters: {
                  limit: { Description: "조회할 뉴스 개수 (1~10, 기본 5)", Type: "integer", Required: false },
                },
              },
              {
                Name: "GetShipmentRisk",
                Description: "특정 선적의 최근 추천 이력(stance, verdict, confidence)을 조회합니다.",
                Parameters: {
                  shipmentId: { Description: "조회할 선적 ID", Type: "string", Required: true },
                },
              },
              {
                Name: "GetMarketSeries",
                Description: "특정 시계열(KCCI 항로 또는 환율/금리)의 최근 N일 데이터와 통계를 조회합니다.",
                Parameters: {
                  seriesId: { Description: "시계열 ID (예: KCCI, KUWI, FX_USD_KRW, BOK_BASE_RATE)", Type: "string", Required: true },
                  days: { Description: "조회 기간 일수 (7~365, 기본 30)", Type: "integer", Required: false },
                },
              },
            ],
          },
        }],
        Instruction: `당신은 PortPulse AI 에이전트입니다. 부산 수출 중소기업의 해운 운임 분석과 부킹 타이밍 의사결정을 지원합니다.

역할:
- 최신 KCCI 운임지수, 환율, 뉴스를 조회해 시황을 분석합니다.
- 사용자의 선적 정보에 기반해 부킹 타이밍을 추천합니다.
- 매일 아침 시황 브리핑을 생성합니다.
- 해운 도메인 지식(항로 특성, Incoterms, 성수기 패턴 등)은 Knowledge Base에서 검색합니다.

동작 원칙:
- 시장 데이터가 필요한 질문에는 반드시 GetMarketSnapshot 또는 GetMarketSeries 도구를 호출하세요.
- 뉴스가 필요하면 GetHighImpactNews를 호출하세요.
- 항로 특성, 운임지수 해석법, Incoterms 같은 안정적 지식은 Knowledge Base를 검색하세요.
- 도구가 반환하지 않은 최신 수치는 추측하지 마세요.
- 물류·해운·환율·부킹과 무관한 요청은 범위를 안내하고 처리하지 마세요.
- 개인 투자상품 매수/매도 추천은 절대 하지 마세요.
- 항상 한국어로 간결하고 실무적으로 답하세요.
        - 확인할 수 없는 내용은 모른다고 답하세요.`,
      },
    });
    // 기존 Agent construct가 사용하던 논리 ID를 유지해 같은 Agent를 업데이트한다.
    agent.overrideLogicalId("PortpulseAgentA7217588");

    // 4-8. Agent Alias
    const agentAlias = new CfnResource(this, "PortPulseAgentAlias", {
      type: "AWS::Bedrock::AgentAlias",
      properties: {
        AgentAliasName: "portpulse-agent-live",
        AgentId: agent.getAtt("AgentId").toString(),
        Description: "PortPulse Agent live alias",
      },
    });
    agentAlias.overrideLogicalId("PortpulseAgentAgentAliasBB3083AF");

    // ============================
    // 5. Data Collectors (변경 없음)
    // ============================

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

    new Rule(this, "WeeklyKcciCollect", {
      schedule: Schedule.cron({ minute: "0", hour: "6", weekDay: "MON" }),
      targets: [new LambdaTarget(kcciCollector, { event: RuleTargetInput.fromObject({ weeks: 4 }) })],
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
    newsTable.grantReadWriteData(newsCollector);
    newsCollector.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );

    new Rule(this, "NewsCollectRule", {
      schedule: Schedule.rate(Duration.hours(3)),
      targets: [new LambdaTarget(newsCollector)],
    });

    // ============================
    // 6. Agent-consuming Lambdas (chat, digest, recommend)
    // ============================

    // Agent invoke policy — chat, digest, recommend, monitor에서 공용
    const agentInvokePolicy = new PolicyStatement({
      actions: ["bedrock:InvokeAgent"],
      resources: [`arn:aws:bedrock:${this.region}:${this.account}:agent-alias/*`],
    });

    // Chat Lambda — Agent 호출만 함
    const chatFn = new LambdaFunction(this, "ChatBot", {
      functionName: "portpulse-chat",
      runtime: Runtime.NODEJS_22_X,
      handler: "chat.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(90),
      memorySize: 256,
      logGroup: new LogGroup(this, "ChatBotLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        BEDROCK_AGENT_ID: agent.getAtt("AgentId").toString(),
        BEDROCK_AGENT_ALIAS_ID: agentAlias.getAtt("AgentAliasId").toString(),
        KB_BUCKET: kbBucket.bucketName,
      },
    });
    chatFn.addToRolePolicy(agentInvokePolicy);
    kbBucket.grantRead(chatFn);

    // News Digest Lambda — Agent 호출 + 텔레그램 발송
    const newsDigest = new LambdaFunction(this, "NewsDigest", {
      functionName: "portpulse-news-digest",
      runtime: Runtime.NODEJS_22_X,
      handler: "news-digest.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(90),
      memorySize: 256,
      logGroup: new LogGroup(this, "NewsDigestLogs", {
        retention: RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        BEDROCK_AGENT_ID: agent.getAtt("AgentId").toString(),
        BEDROCK_AGENT_ALIAS_ID: agentAlias.getAtt("AgentAliasId").toString(),
        TELEGRAM_SECRET_NAME: telegramSecret.secretName,
      },
    });
    newsDigest.addToRolePolicy(agentInvokePolicy);
    telegramSecret.grantRead(newsDigest);

    new Rule(this, "DailyDigestRule", {
      schedule: Schedule.cron({ minute: "0", hour: "22" }),
      targets: [new LambdaTarget(newsDigest)],
    });

    // API Query Lambda — 프론트엔드 읽기 API (시계열/뉴스/선적/회사/추천)
    // 추천 생성 시 Agent 호출도 함
    const apiQuery = new LambdaFunction(this, "ApiQuery", {
      functionName: "portpulse-api-query",
      runtime: Runtime.NODEJS_22_X,
      handler: "api.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(90),
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
        BEDROCK_AGENT_ID: agent.getAtt("AgentId").toString(),
        BEDROCK_AGENT_ALIAS_ID: agentAlias.getAtt("AgentAliasId").toString(),
        BEDROCK_MODEL_ID: "global.anthropic.claude-opus-4-5-20251101-v1:0",
      },
    });
    table.grantReadData(apiQuery);
    newsTable.grantReadData(apiQuery);
    recoTable.grantReadWriteData(apiQuery);
    companyBucket.grantReadWrite(apiQuery);
    apiQuery.addToRolePolicy(agentInvokePolicy);
    // shipment advisor에서 아직 Converse 직접 호출도 사용 (shipment-query.mjs)
    apiQuery.addToRolePolicy(
      new PolicyStatement({ actions: ["bedrock:InvokeModel", "bedrock:Converse"], resources: ["*"] }),
    );

    // Reco Monitor Lambda — Agent 호출(recommend.mjs 경유) + 텔레그램 발송
    const recoMonitor = new LambdaFunction(this, "RecoMonitor", {
      functionName: "portpulse-reco-monitor",
      runtime: Runtime.NODEJS_22_X,
      handler: "recommend-monitor.handler",
      code: Code.fromAsset(lambdaDir),
      timeout: Duration.seconds(90),
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
        BEDROCK_AGENT_ID: agent.getAtt("AgentId").toString(),
        BEDROCK_AGENT_ALIAS_ID: agentAlias.getAtt("AgentAliasId").toString(),
        TELEGRAM_SECRET_NAME: telegramSecret.secretName,
      },
    });
    table.grantReadData(recoMonitor);
    newsTable.grantReadData(recoMonitor);
    recoTable.grantReadWriteData(recoMonitor);
    companyBucket.grantRead(recoMonitor);
    telegramSecret.grantRead(recoMonitor);
    recoMonitor.addToRolePolicy(agentInvokePolicy);

    new Rule(this, "DailyRecoReview", {
      schedule: Schedule.cron({ minute: "30", hour: "22" }),
      targets: [new LambdaTarget(recoMonitor)],
    });

    // ============================
    // 7. API Gateway
    // ============================

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

    // ============================
    // 8. Outputs
    // ============================

    new CfnOutput(this, "TableName", { value: table.tableName });
    new CfnOutput(this, "NewsTableName", { value: newsTable.tableName });
    new CfnOutput(this, "RecoTableName", { value: recoTable.tableName });
    new CfnOutput(this, "CollectorName", { value: collector.functionName });
    new CfnOutput(this, "KcciCollectorName", { value: kcciCollector.functionName });
    new CfnOutput(this, "NewsCollectorName", { value: newsCollector.functionName });
    new CfnOutput(this, "NewsDigestName", { value: newsDigest.functionName });
    new CfnOutput(this, "TelegramSecretName", { value: telegramSecret.secretName });
    new CfnOutput(this, "ApiQueryName", { value: apiQuery.functionName });
    new CfnOutput(this, "ChatBotName", { value: chatFn.functionName });
    new CfnOutput(this, "CompanyBucketName", { value: companyBucket.bucketName });
    new CfnOutput(this, "RecoMonitorName", { value: recoMonitor.functionName });
    new CfnOutput(this, "AgentToolsName", { value: agentToolsFn.functionName });
    new CfnOutput(this, "AgentId", { value: agent.getAtt("AgentId").toString() });
    new CfnOutput(this, "AgentAliasId", { value: agentAlias.getAtt("AgentAliasId").toString() });
    new CfnOutput(this, "GuardrailId", { value: guardrail.getAtt("GuardrailId").toString() });
    new CfnOutput(this, "KnowledgeBaseId", { value: knowledgeBase.ref });
    new CfnOutput(this, "KBDataSourceId", { value: kbDataSource.getAtt("DataSourceId").toString() });
    new CfnOutput(this, "KBBucketName", { value: kbBucket.bucketName });
    new CfnOutput(this, "KBVectorBucketArn", { value: kbVectorBucket.attrVectorBucketArn });
    new CfnOutput(this, "KBVectorIndexArn", { value: kbVectorIndex.attrIndexArn });
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
  }
}
