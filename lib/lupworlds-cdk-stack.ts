import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LambdaRestApi } from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";

export class LupworldsCdkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const usersTable = new dynamodb.Table(this, "UsersTable", {
            tableName: "Users",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
        });

        const charactersTable = new dynamodb.Table(this, "CharactersTable", {
            tableName: "Characters",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
        });

        const characterImagesBucket = new s3.Bucket(
            this,
            "CharacterImagesBucket",
            {
                removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
                autoDeleteObjects: true, // DEV only
            },
        );

        const apiLambda = new NodejsFunction(this, "LupworldsLambda", {
            entry: "apiProxyLambda/index.ts",
            handler: "handler",
            runtime: lambda.Runtime.NODEJS_22_X,
            functionName: "LupworldsLambda",
            environment: {
                CHARACTERS_TABLE_NAME: charactersTable.tableName,
                CHARACTER_IMAGES_BUCKET_NAME: characterImagesBucket.bucketName,
                USERS_TABLE_NAME: usersTable.tableName,
            },
        });

        charactersTable.grantReadWriteData(apiLambda);
        characterImagesBucket.grantReadWrite(apiLambda);
        usersTable.grantReadWriteData(apiLambda);

        new LambdaRestApi(this, "LupworldsRestAPI", {
            handler: apiLambda,
            proxy: true,
        });
    }
}
