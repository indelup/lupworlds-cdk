#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { LupworldsCdkStack } from "../lib/lupworlds-cdk-stack";

const app = new cdk.App();
new LupworldsCdkStack(app, "LupworldsCdkStack", {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
    },
});
