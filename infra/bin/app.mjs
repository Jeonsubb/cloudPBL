import { App } from "aws-cdk-lib";
import { MarketStack } from "../lib/market-stack.mjs";

const app = new App();
new MarketStack(app, "portpulse-market", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "ap-northeast-2",
  },
});
