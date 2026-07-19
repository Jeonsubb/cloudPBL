// PortPulse Bedrock Guardrail + Knowledge Base(RAG) 인프라.
//
// 2026-07-19 사고 기록: 이 두 리소스(+연결된 S3 Vectors/문서 버킷)는 원래 kimminseo가 로컬에서
// 직접 만들어 배포했었고, git에는 커밋되지 않은 상태였다. 다른 브랜치(final) 기준 cdk deploy가
// 그 리소스들을 "코드에 없는 것"으로 판단해 전부 삭제했다 — 인제스천된 문서 원본도 S3
// autoDeleteObjects로 함께 소실(버전관리 없었음, AWS Backup 없음, 복구 불가 확인).
// 이 파일은 CloudTrail에 남은 삭제 직전 설정값(임베딩모델·청킹·스토리지 타입 등은 정확히 복원,
// Guardrail 정책 세부 내용은 보안상 CloudTrail에도 안 남아 architecture.drawio의 명시된 의도대로
// 재구성)을 기반으로 한 재구축본이다. kimminseo의 원본 코드/문서가 발견되면 이 파일을 그걸로
// 교체할 것. 복구 후에는 로컬 knowledge-base 문서를 다시 S3에 올려 인제스천한다.
import { Duration, RemovalPolicy, Stack } from "aws-cdk-lib";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { Role, ServicePrincipal, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { CfnGuardrail, CfnKnowledgeBase, CfnDataSource } from "aws-cdk-lib/aws-bedrock";
import { CfnVectorBucket, CfnIndex } from "aws-cdk-lib/aws-s3vectors";
import { Construct } from "constructs";

const EMBEDDING_MODEL_ARN = "arn:aws:bedrock:ap-northeast-2::foundation-model/amazon.titan-embed-text-v2:0";
const EMBEDDING_DIMENSION = 1024;

// Guardrail — architecture.drawio에 명시된 4대 정책(Prompt Injection 차단·PII 익명화·
// 투자조언 거부·유해콘텐츠 필터)을 표준 설정으로 재구성. 정확한 원본 세부값은 복구 불가.
export class PortpulseGuardrail extends Construct {
  constructor(scope, id) {
    super(scope, id);

    const guardrail = new CfnGuardrail(this, "Guardrail", {
      name: "portpulse-chat-guardrail",
      description: "PortPulse 챗봇/어드바이저 가드레일 — 프롬프트 인젝션·PII·투자조언·유해콘텐츠",
      blockedInputMessaging: "죄송합니다, 그 요청은 처리할 수 없습니다.",
      blockedOutputsMessaging: "죄송합니다, 이 응답은 정책상 제공할 수 없습니다.",
      contentPolicyConfig: {
        filtersConfig: [
          { type: "PROMPT_ATTACK", inputStrength: "HIGH", outputStrength: "NONE" },
          { type: "SEXUAL", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "VIOLENCE", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "HATE", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "INSULTS", inputStrength: "HIGH", outputStrength: "HIGH" },
          { type: "MISCONDUCT", inputStrength: "HIGH", outputStrength: "HIGH" },
        ],
      },
      topicPolicyConfig: {
        topicsConfig: [
          {
            name: "investment-advice-block",
            type: "DENY",
            definition: "특정 종목·자산의 매수/매도 시점, 수익률 예측, 개인 맞춤 투자·재무 자문 등 금융투자업법상 투자자문에 해당하는 발언",
            examples: ["이 운임 지금 사도 될까요?", "이 시황이면 주식은 어떻게 될까요?", "제 자산을 어떻게 굴려야 하나요?"],
          },
        ],
      },
      sensitiveInformationPolicyConfig: {
        // 항구명·도착지(Busan/Hamburg 등)는 핵심 물류 데이터라 ADDRESS 익명화는 넣지 않는다
        // — 넣으면 챗봇 답변에서 항구가 {ADDRESS}로 가려진다(2026-07-19 확인).
        piiEntitiesConfig: [
          { type: "EMAIL", action: "ANONYMIZE" },
          { type: "PHONE", action: "ANONYMIZE" },
          { type: "CREDIT_DEBIT_CARD_NUMBER", action: "BLOCK" },
          { type: "US_SOCIAL_SECURITY_NUMBER", action: "BLOCK" },
        ],
      },
    });

    // 에이전트는 guardrail의 DRAFT를 참조 — 가드레일 정책을 고쳐도 새 버전 발행/재연결 없이 즉시 반영된다.
    this.guardrailId = guardrail.attrGuardrailId;
    this.guardrailVersion = "DRAFT";
  }
}

// Knowledge Base(RAG) — S3 Vectors 저장, Titan Embed v2, FIXED_SIZE 청킹(512토큰/20% 오버랩).
// 전부 삭제 직전 CloudTrail 관측값과 동일. 문서는 배포 후 별도 동기화·인제스천한다.
export class PortpulseKnowledgeBase extends Construct {
  constructor(scope, id) {
    super(scope, id);
    const stack = Stack.of(this);

    // KB 원본 문서 버킷 — 스택 삭제/교체와 문서 수명을 분리해 지난 유실 사고 재발을 막는다.
    const docsBucket = new Bucket(this, "KnowledgeBaseBucket", {
      bucketName: `portpulse-knowledge-base-${stack.account}`,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const vectorBucket = new CfnVectorBucket(this, "KnowledgeBaseVectorBucket", {
      vectorBucketName: `portpulse-kb-vectors-${stack.account}`,
    });
    vectorBucket.applyRemovalPolicy(RemovalPolicy.RETAIN);
    const vectorIndex = new CfnIndex(this, "KnowledgeBaseVectorIndex", {
      // Bedrock은 청크 원문/내부 메타데이터를 아래 두 키에 저장한다. 이를 filterable로 두면
      // S3 Vectors의 2KB 제한을 넘어 모든 PDF 인제스천이 실패하므로 반드시 non-filterable로 둔다.
      indexName: "portpulse-kb-index-v2",
      vectorBucketName: vectorBucket.vectorBucketName,
      dimension: EMBEDDING_DIMENSION,
      dataType: "float32",
      distanceMetric: "cosine",
      metadataConfiguration: {
        nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"],
      },
    });
    vectorIndex.addDependency(vectorBucket);

    const kbRole = new Role(this, "KnowledgeBaseRole", {
      roleName: "portpulse-bedrock-kb-role",
      assumedBy: new ServicePrincipal("bedrock.amazonaws.com"),
    });
    kbRole.addToPolicy(new PolicyStatement({
      actions: ["bedrock:InvokeModel"],
      resources: [EMBEDDING_MODEL_ARN],
    }));
    kbRole.addToPolicy(new PolicyStatement({
      actions: ["s3vectors:*"],
      resources: [vectorBucket.attrVectorBucketArn, `${vectorBucket.attrVectorBucketArn}/*`],
    }));
    docsBucket.grantRead(kbRole);

    const kb = new CfnKnowledgeBase(this, "PortPulseKnowledgeBase", {
      // v1 인덱스에는 Bedrock 내부 메타데이터의 non-filterable 설정이 빠져 인제스천이 전부 실패했다.
      // StorageConfiguration 변경이 KB 교체로 판정되는 경우에도 기존 이름과 충돌하지 않도록 v2로 구분한다.
      name: "portpulse-knowledge-base-v2",
      description: "PortPulse KOBC·DCSA 해운 도메인 문서 RAG",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: { embeddingModelArn: EMBEDDING_MODEL_ARN },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: { vectorBucketArn: vectorBucket.attrVectorBucketArn, indexArn: vectorIndex.attrIndexArn },
      },
    });
    kb.applyRemovalPolicy(RemovalPolicy.RETAIN);
    kb.addDependency(vectorIndex);
    kb.node.addDependency(kbRole);

    const dataSource = new CfnDataSource(this, "KBDataSource", {
      knowledgeBaseId: kb.attrKnowledgeBaseId,
      name: "portpulse-kb-s3-source",
      dataDeletionPolicy: "RETAIN", // 데이터소스 삭제해도 이미 넣은 벡터는 유지(다음 사고 완화)
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: { bucketArn: docsBucket.bucketArn },
      },
      vectorIngestionConfiguration: {
        chunkingConfiguration: {
          chunkingStrategy: "FIXED_SIZE",
          fixedSizeChunkingConfiguration: { maxTokens: 512, overlapPercentage: 20 },
        },
      },
    });

    this.knowledgeBaseId = kb.attrKnowledgeBaseId;
    this.dataSourceId = dataSource.attrDataSourceId;
    this.docsBucket = docsBucket;
    this.configVersion = "rag-v2-s3vectors-metadata";
  }
}
