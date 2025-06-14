import * as cdk from 'aws-cdk-lib'
import { Fn, Stack } from 'aws-cdk-lib'
import * as AmplifyHelpers from '@aws-amplify/cli-extensibility-helper'
import { AmplifyDependentResourcesAttributes } from '../../types/amplify-dependent-resources-ref'
import { Construct } from 'constructs'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as sns from 'aws-cdk-lib/aws-sns'
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions'
import * as events from 'aws-cdk-lib/aws-events'
import * as targets from 'aws-cdk-lib/aws-events-targets'
import * as pipes from 'aws-cdk-lib/aws-pipes'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'


export class cdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps, amplifyResourceProps?: AmplifyHelpers.AmplifyResourceProps) {
    super(scope, id, props)
    /* Do not remove - Amplify CLI automatically injects the current deployment environment in this input parameter */
    new cdk.CfnParameter(this, 'env', {
      type: 'String',
      description: 'Current Amplify CLI env name',
    })
    /* AWS CDK code goes here - learn more: https://docs.aws.amazon.com/cdk/latest/guide/home.html */
    const amplifyProjectInfo = AmplifyHelpers.getProjectInfo()
    const dependencies: AmplifyDependentResourcesAttributes = AmplifyHelpers.addResourceDependency(this,
      amplifyResourceProps.category,
      amplifyResourceProps.resourceName,
      [{
        category: "api",
        resourceName: "notificationdemo"
      },
      {
        category: "function",
        resourceName: "feedbackProcessor"
      },]
    )
    const apiId = cdk.Fn.ref(dependencies.api.notificationdemo.GraphQLAPIIdOutput)
    const feedbackProcessorArn = cdk.Fn.ref(dependencies.function.feedbackProcessor.Arn)


    const streamArn = Fn.importValue(
      cdk.Fn.sub('${apiId}:GetAtt:FeedbackTable:StreamArn', {
        apiId: apiId,
      })
    )
    const apiName = 'notificationdemo'
    const modelName = 'Feedback'
    
    // Dynamo table
    const tableName = cdk.Fn.importValue(`api${apiName}:GetAtt:${modelName}Table:Name`)
    const table = dynamodb.Table.fromTableName(this, `${modelName}Table`, tableName)

    // EventBridge custom bus
    const bus = new events.EventBus(this, 'CustomBus', {
      eventBusName: `Demo-${amplifyProjectInfo.projectName}-${cdk.Fn.ref('env')}`,
    })

    // IAM role for the pipe
    const pipeRole = new iam.Role(this, 'PipeRole', {
      assumedBy: new iam.ServicePrincipal('pipes.amazonaws.com'),
      inlinePolicies: {
        PipePolicy: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'dynamodb:DescribeStream',
                'dynamodb:GetRecords',
                'dynamodb:GetShardIterator',
                'dynamodb:ListStreams'
              ],
              resources: [
                Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/Feedback-*/stream/*')
              ]
            }),
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['events:PutEvents'],
              resources: [bus.eventBusArn]
            })
          ]
        })
      }
    })

    const streamPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:ListStreams'
      ],
      resources: [
        cdk.Fn.sub('${TableArn}/stream/*', {
          TableArn: table.tableArn
        })
      ]
    })

    // Permissions for Pipe to put events to bus
    bus.grantPutEventsTo(pipeRole)

    // EventBridge Pipe from DynamoDB Stream to Bus
    const pipe = new pipes.CfnPipe(this, 'DDBStreamToBusPipe', {
      roleArn: pipeRole.roleArn,
      source: streamArn,
      // source: Fn.sub('arn:aws:dynamodb:${AWS::Region}:${AWS::AccountId}:table/${modelName}-${appId}-${stage}/stream/${streamLabel}',
      //   {
      //     modelName: modelName,
      //     appId: apiId,
      //     stage: cdk.Fn.ref('env'),
      //     streamLabel: '2025-06-06T22:04:52.960',
      //   }
      // ),
      sourceParameters: {
        dynamoDbStreamParameters: {
          startingPosition: 'LATEST',
        },
      },
      target: bus.eventBusArn,
      targetParameters: {
        eventBridgeEventBusParameters: {
          source: 'my.ddb.pipe',
          detailType: 'ddb-stream-record',
        },
      },
    })

    const ddbStreamRule = new events.Rule(this, 'DDBStreamRule', {
      eventBus: bus, // Your custom EventBridge bus
      description: 'Rule to process DynamoDB stream events from Feedback table',
      eventPattern: {
        source: ['my.ddb.pipe'], // Matches the source you set in your pipe
        detailType: ['ddb-stream-record'], // Matches the detailType you set
        // Optional: Add more specific filtering
        detail: {
          // Filter by DynamoDB event types
          eventName: ['INSERT', 'MODIFY', 'REMOVE'],
          // Or filter by specific attributes
          // dynamodb: {
          //   NewImage: {
          //     status: {
          //       S: ['ACTIVE', 'PENDING']
          //     }
          //   }
          // }
        }
      }
    })

    // Lambda configuration
    const feedbackProcessorFunction = lambda.Function.fromFunctionArn(
      this, 
      'feedbackProcessorFunction', 
      feedbackProcessorArn
    )

   
    new cdk.aws_lambda.CfnPermission(this, 'LambdaEventBridgePermission', {
      functionName: feedbackProcessorFunction.functionName, // Use function name instead of ARN
      action: 'lambda:InvokeFunction',
      principal: 'events.amazonaws.com',
      sourceArn: ddbStreamRule.ruleArn,
    })

    ddbStreamRule.addTarget(new targets.LambdaFunction(feedbackProcessorFunction))

    // SNS Configuration
    const emailAddress = "alex_demo@yopmail.com"

    const snsTopicResourceName = `sns-topic-${amplifyProjectInfo.projectName}-${cdk.Fn.ref('env')}`
    const topic = new sns.Topic(this, 'sns-topic', {
      topicName: snsTopicResourceName,
    })

    topic.addSubscription(new subs.EmailSubscription(emailAddress))
    new cdk.CfnOutput(this, 'snsTopicArn', {
      value: topic.topicArn,
      description: 'The arn of the SNS topic',
    })

    ddbStreamRule.addTarget(new targets.SnsTopic(topic))
  }
}