import { App } from "aws-cdk-lib";
import { MarketStack } from "../lib/market-stack.mjs";

const app = new App();
const region = process.env.PORTPULSE_REGION
  ?? process.env.AWS_REGION
  ?? process.env.AWS_DEFAULT_REGION
  ?? "ap-northeast-2";

new MarketStack(app, "portpulse-market", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region,
  },
});
