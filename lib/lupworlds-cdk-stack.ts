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

        const materialsTable = new dynamodb.Table(this, "MaterialsTable", {
            tableName: "Materials",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
        });

        const actionsTable = new dynamodb.Table(this, "ActionsTable", {
            tableName: "Actions",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
        });

        const bannersTable = new dynamodb.Table(this, "BannersTable", {
            tableName: "Banners",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
        });

        const worldsTable = new dynamodb.Table(this, "WorldsTable", {
            tableName: "Worlds",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
            removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
        });

        const playerWorldDataTable = new dynamodb.Table(
            this,
            "PlayerWorldDataTable",
            {
                tableName: "PlayerWorldData",
                partitionKey: {
                    name: "userId",
                    type: dynamodb.AttributeType.STRING,
                },
                sortKey: {
                    name: "worldId",
                    type: dynamodb.AttributeType.STRING,
                },
                removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
            },
        );

        // Add GSI for querying by twitchId
        usersTable.addGlobalSecondaryIndex({
            indexName: "TwitchIdIndex",
            partitionKey: {
                name: "twitchId",
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // Add GSI for querying by worldId
        charactersTable.addGlobalSecondaryIndex({
            indexName: "WorldIdIndex",
            partitionKey: {
                name: "worldId",
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        materialsTable.addGlobalSecondaryIndex({
            indexName: "WorldIdIndex",
            partitionKey: {
                name: "worldId",
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        actionsTable.addGlobalSecondaryIndex({
            indexName: "WorldIdIndex",
            partitionKey: {
                name: "worldId",
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        bannersTable.addGlobalSecondaryIndex({
            indexName: "WorldIdIndex",
            partitionKey: {
                name: "worldId",
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        const bucketProps = {
            removalPolicy: cdk.RemovalPolicy.DESTROY, // DEV only
            autoDeleteObjects: true, // DEV only
            publicReadAccess: true,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS_ONLY,
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.POST,
                        s3.HttpMethods.DELETE,
                    ],
                    allowedOrigins: ["*"], // Update for production
                    allowedHeaders: ["*"],
                    exposedHeaders: ["ETag"],
                    maxAge: 3000,
                },
            ],
        };

        const assetImagesBucket = new s3.Bucket(this, "AssetImagesBucket", bucketProps);
        const configImagesBucket = new s3.Bucket(this, "ConfigImagesBucket", bucketProps);

        const apiLambda = new NodejsFunction(this, "LupworldsLambda", {
            entry: "apiProxyLambda/index.ts",
            handler: "handler",
            runtime: lambda.Runtime.NODEJS_22_X,
            functionName: "LupworldsLambda",
            environment: {
                CHARACTERS_TABLE_NAME: charactersTable.tableName,
                MATERIALS_TABLE_NAME: materialsTable.tableName,
                ACTIONS_TABLE_NAME: actionsTable.tableName,
                USERS_TABLE_NAME: usersTable.tableName,
                BANNERS_TABLE_NAME: bannersTable.tableName,
                PLAYER_WORLD_DATA_TABLE_NAME: playerWorldDataTable.tableName,
                WORLDS_TABLE_NAME: worldsTable.tableName,
                ASSET_IMAGES_BUCKET_NAME: assetImagesBucket.bucketName,
                CONFIG_IMAGES_BUCKET_NAME: configImagesBucket.bucketName,
            },
        });

        usersTable.grantReadWriteData(apiLambda);
        charactersTable.grantReadWriteData(apiLambda);
        materialsTable.grantReadWriteData(apiLambda);
        actionsTable.grantReadWriteData(apiLambda);
        bannersTable.grantReadWriteData(apiLambda);
        playerWorldDataTable.grantReadWriteData(apiLambda);
        worldsTable.grantReadWriteData(apiLambda);
        assetImagesBucket.grantReadWrite(apiLambda);
        configImagesBucket.grantReadWrite(apiLambda);

        new LambdaRestApi(this, "LupworldsRestAPI", {
            handler: apiLambda,
            proxy: true,
        });
    }
}
