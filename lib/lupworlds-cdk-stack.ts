import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from "aws-cdk-lib/aws-lambda";
import { OpenApiGatewayToLambda } from '@aws-solutions-constructs/aws-openapigateway-lambda';
import { LambdaToDynamoDB } from '@aws-solutions-constructs/aws-lambda-dynamodb';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import * as path from 'path';
import * as ddb from 'aws-cdk-lib/aws-dynamodb';

export class LupworldsCdkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const simpleTableProps = {
            partitionKey: {
                name: "id",
                type: ddb.AttributeType.STRING,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        }

        const userApparatus = new LambdaToDynamoDB(this, "UserApparatus", {
            lambdaFunctionProps: {
                runtime: lambda.Runtime.NODEJS_22_X,
                handler: "index.handler",
                code: lambda.Code.fromAsset("src/user"),
            },
            dynamoTableProps: simpleTableProps,
        });

        const userApi = new OpenApiGatewayToLambda(this, "UserOpenApiGatewayToLambda", {
            apiDefinitionAsset: new Asset(this, 'ApiDefinitionAsset', {
                path: path.join("openapi", "users-api.yaml"),
            }),
            apiIntegrations: [
                {
                    id: "UserHandler",
                    existingLambdaObj: userApparatus.lambdaFunction
                }
            ]
        });

        new cdk.CfnOutput(this, "UserUrl", {
            value: userApi.apiGateway.url + "users",
        });      

        // Defines Lambda function resource
        //const handleUserRequest = new lambda.Function(
        //    this,
        //    "HandleUserRequest",
        //    {
        //        code: lambda.Code.fromAsset("src/user"),
        //        handler: "index.handler",
        //        runtime: lambda.Runtime.NODEJS_22_X,
        //    },
        //);

        //const userHandlerUrl = handleUserRequest.addFunctionUrl({
        //    authType: lambda.FunctionUrlAuthType.NONE,
        //});

        //  new cdk.CfnOutput(this, "userHandlerUrl", {
        //    value: userHandlerUrl.url,
        //});

        // example resource
        // const queue = new sqs.Queue(this, 'LupworldsCdkQueue', {
        //   visibilityTimeout: cdk.Duration.seconds(300)
        // });
    }
}
