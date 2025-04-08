import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';

export class LupworldsCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Defines Lambda function resource
    const handleUserRequest = new lambda.Function(this, 'HandleUserRequest', {
      code: lambda.Code.fromAsset('src/user'),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_22_X,
    });

    const userHandlerUrl = handleUserRequest.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, 'userHandlerUrl', {
      value: userHandlerUrl.url,
    })
    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'LupworldsCdkQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
