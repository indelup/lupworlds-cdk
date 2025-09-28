import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LambdaRestApi, RestApi, LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as s3 from "aws-cdk-lib/aws-s3";

export class LupworldsCdkStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // Helper function para obtener variables de entorno
        const getEnvVar = (key: string, defaultValue?: string): string => {
            const value = process.env[key];
            if (!value && !defaultValue) {
                throw new Error(`Environment variable ${key} is required`);
            }
            return value || defaultValue!;
        };

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

        const bannersTable = new dynamodb.Table(this, "BannersTable", {
            tableName: "Banners",
            partitionKey: {
                name: "id",
                type: dynamodb.AttributeType.STRING,
            },
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

        bannersTable.addGlobalSecondaryIndex({
            indexName: "WorldIdIndex",
            partitionKey: {
                name: "worldId",
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        const characterImagesBucket = new s3.Bucket(
            this,
            "CharacterImagesBucket",
            {
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
            },
        );

        const materialImagesBucket = new s3.Bucket(
            this,
            "MaterialImagesBucket",
            {
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
            },
        );

        const bannerImagesBucket = new s3.Bucket(this, "BannerImagesBucket", {
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
        });

        const apiLambda = new NodejsFunction(this, "LupworldsLambda", {
            entry: "apiProxyLambda/index.ts",
            handler: "handler",
            runtime: lambda.Runtime.NODEJS_22_X,
            functionName: "LupworldsLambda",
            environment: {
                JWT_SECRET: getEnvVar("JWT_SECRET"),
                CHARACTERS_TABLE_NAME: charactersTable.tableName,
                CHARACTER_IMAGES_BUCKET_NAME: characterImagesBucket.bucketName,
                MATERIALS_TABLE_NAME: materialsTable.tableName,
                MATERIALS_IMAGES_BUCKET_NAME: materialImagesBucket.bucketName,
                USERS_TABLE_NAME: usersTable.tableName,
                BANNERS_TABLE_NAME: bannersTable.tableName,
                BANNER_IMAGES_BUCKET_NAME: bannerImagesBucket.bucketName,
            },
        });

        // Lambda de autenticación
        const authLambda = new NodejsFunction(this, "AuthLambda", {
            entry: "authLambda/index.ts",
            handler: "handler",
            runtime: lambda.Runtime.NODEJS_22_X,
            functionName: "LupworldsAuthLambda",
            environment: {
                TWITCH_CLIENT_ID: getEnvVar("TWITCH_CLIENT_ID"),
                TWITCH_CLIENT_SECRET: getEnvVar("TWITCH_CLIENT_SECRET"),
                TWITCH_REDIRECT_URI: getEnvVar("TWITCH_REDIRECT_URI", "http://localhost:8080/auth/callback"),
                JWT_SECRET: getEnvVar("JWT_SECRET"),
                USERS_TABLE_NAME: usersTable.tableName,
                FRONTEND_URL: getEnvVar("FRONTEND_URL", "http://localhost:8080"),
            },
        });

        usersTable.grantReadWriteData(apiLambda);
        usersTable.grantReadWriteData(authLambda);
        charactersTable.grantReadWriteData(apiLambda);
        characterImagesBucket.grantReadWrite(apiLambda);
        materialsTable.grantReadWriteData(apiLambda);
        materialImagesBucket.grantReadWrite(apiLambda);
        bannersTable.grantReadWriteData(apiLambda);
        bannerImagesBucket.grantReadWrite(apiLambda);

        // API Gateway para autenticación
        const authApi = new RestApi(this, "AuthApi", {
            restApiName: "Lupworlds Auth Service",
            description: "Authentication service for Lupworlds",
            defaultCorsPreflightOptions: {
                allowOrigins: [getEnvVar("FRONTEND_URL", "http://localhost:8080")],
                allowMethods: ["GET", "POST", "OPTIONS"],
                allowHeaders: ["Content-Type"],
                allowCredentials: true, // IMPORTANTE para cookies
                maxAge: cdk.Duration.days(1),
            },
        });

        authApi.root.addResource("auth").addMethod("GET", new LambdaIntegration(authLambda));
        authApi.root.addResource("callback").addMethod("GET", new LambdaIntegration(authLambda));
        authApi.root.addResource("logout").addMethod("POST", new LambdaIntegration(authLambda));

        // API Gateway principal con CORS para cookies
        new LambdaRestApi(this, "LupworldsRestAPI", {
            handler: apiLambda,
            proxy: true,
            defaultCorsPreflightOptions: {
                allowOrigins: [getEnvVar("FRONTEND_URL", "http://localhost:8080")],
                allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                allowHeaders: ["Content-Type", "Authorization"],
                allowCredentials: true, // IMPORTANTE para cookies
                maxAge: cdk.Duration.days(1),
            },
        });
    }
}
