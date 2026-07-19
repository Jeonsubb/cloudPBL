// PortPulse 프론트 공개 배포 — S3(비공개) + CloudFront(OAC) + 콘텐츠 자동 업로드/무효화.
// 구조도의 "① S3 정적 웹 + CloudFront"에 해당. 정적 파일만 서빙하고 API/Cognito는 프론트가 직접 호출한다.
import { RemovalPolicy } from "aws-cdk-lib";
import { Bucket, BlockPublicAccess } from "aws-cdk-lib/aws-s3";
import { Distribution, ViewerProtocolPolicy, CachePolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";

const frontendDir = fileURLToPath(new URL("../../frontend", import.meta.url));

export class PortpulseWeb extends Construct {
  constructor(scope, id) {
    super(scope, id);

    const bucket = new Bucket(this, "WebBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL, // 퍼블릭 접근 차단 — CloudFront OAC로만 읽는다.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, "WebDist", {
      comment: "PortPulse frontend",
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // 데모 트래픽이라 캐시 미사용 — 재배포 즉시 반영(정적사이트 스테일 제거). 실서비스 전환 시 캐시 정책 부여.
        cachePolicy: CachePolicy.CACHING_DISABLED,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // frontend/ 폴더 전체를 버킷에 업로드하고 배포 때마다 CloudFront 무효화.
    new BucketDeployment(this, "WebDeploy", {
      sources: [Source.asset(frontendDir)],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ["/*"],
    });

    this.bucket = bucket;
    this.distribution = distribution;
    this.url = `https://${distribution.distributionDomainName}`;
  }
}
