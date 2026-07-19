// PortPulse 인증 인프라 — 회사별 계정(멀티테넌시)의 기반.
// 한 Cognito 사용자 = 한 회사. companyId는 그 사용자의 sub(고유 id)를 그대로 쓴다.
// 회사 표시명은 표준 속성 name에 저장(가입 시 입력).
//
// 프론트(정적 S3)는 SDK 번들 없이 Cognito InitiateAuth(USER_PASSWORD_AUTH)를 fetch로 직접 호출해
// IdToken을 받고, 그 토큰을 API 요청 Authorization 헤더로 보낸다. HTTP API의 JWT authorizer가 검증하고,
// 각 Lambda는 event.requestContext.authorizer.jwt.claims.sub 에서 companyId를 읽는다.
import { RemovalPolicy } from "aws-cdk-lib";
import { UserPool, AccountRecovery, VerificationEmailStyle } from "aws-cdk-lib/aws-cognito";
import { HttpUserPoolAuthorizer } from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import { Construct } from "constructs";

export class PortpulseAuth extends Construct {
  constructor(scope, id) {
    super(scope, id);

    const userPool = new UserPool(this, "UserPool", {
      userPoolName: "portpulse-companies",
      selfSignUpEnabled: true, // 회사가 직접 가입
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        // 회사 표시명 — 가입 폼에서 받는다(필수).
        fullname: { required: true, mutable: true },
      },
      userVerification: {
        emailSubject: "PortPulse 이메일 인증 코드",
        emailBody: "PortPulse 가입 인증 코드: {####}",
        emailStyle: VerificationEmailStyle.CODE,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireUppercase: false,
        requireSymbols: false,
      },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      // 개발 스택: 스택 삭제 시 유저풀도 삭제. 운영 전환 시 RETAIN.
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // 퍼블릭 SPA 클라이언트(시크릿 없음). USER_PASSWORD_AUTH로 프론트에서 직접 토큰 발급.
    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: "portpulse-web",
      authFlows: { userPassword: true, userSrp: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
    });

    // HTTP API용 authorizer — 회사데이터 경로에만 부착한다(전역 시장데이터는 공개 유지).
    const authorizer = new HttpUserPoolAuthorizer("CompanyAuthorizer", userPool, {
      userPoolClients: [userPoolClient],
    });

    this.userPool = userPool;
    this.userPoolClient = userPoolClient;
    this.authorizer = authorizer;
  }
}
