import { join } from 'path';
import { CfnResource, Duration, RemovalPolicy, SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { FilterPattern, LogGroup, LogStream, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { KinesisDestination } from 'aws-cdk-lib/aws-logs-destinations';
import { Stream, StreamMode } from 'aws-cdk-lib/aws-kinesis';
import { CfnDeliveryStream } from 'aws-cdk-lib/aws-kinesisfirehose';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';

interface CloudWatchToSplunkProps {
    /**
    * The CloudWatch Log Groups that
    * will be shipped to Splunk.
    * 
    * Your Splunk HEC must be configured
    * to send indexer acknowledgements so
    * Kinesis knows if events have been
    * ingested correctly.
    */
    readonly logGroups: LogGroup[]
    /**
     * The Splunk HTTP Event Collector endpoint.
     * 
     * The endpoint must use SSL/TLS.
     * 
     * @example 'https://splunk.mydomain.com:8088'
     */
    readonly hecEndpoint: string
    /**
     * The Splunk HTTP Event Collector token.
     */
    readonly hecToken: SecretValue
}

export class CloudWatchToSplunk extends Construct {
    /**
    * Sends events in CloudWatch Log Groups
    * to a Splunk HTTP Event Collector.
    */
    constructor(scope: Construct, id: string, props: CloudWatchToSplunkProps) {
        super(scope, id);
        
        /**
        * The ingest stream.
        */
        const ingestStream = new Stream(this, 'IngestStream', {
            streamMode: StreamMode.ON_DEMAND
        });
        
        /**
        * Configure the log group to send logs
        * to the ingest stream.
        */
        props.logGroups.forEach(logGroup => {
            logGroup.addSubscriptionFilter('kinesis', {
                destination: new KinesisDestination(ingestStream),
                filterPattern: FilterPattern.allEvents()
            });
        });
        
        /**
        * Events that were not delivered successfully
        * will be sent to this Bucket.
        */
        const backupBucket = new Bucket(this, 'BackupBucket', {
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true
        });
        
        /**
        * Create a log group specifically for Kinesis delivery errors.
        */
        const kinesisDeliveryStreamLogs = new LogGroup(this, 'KinesisDeliveryStreamLogs', {
            removalPolicy: RemovalPolicy.DESTROY,
            retention: RetentionDays.ONE_DAY,
        });
        const kinesisErrorsLogStream = new LogStream(this, 'KinesisErrorLogStream', {
            logGroup: kinesisDeliveryStreamLogs,
            logStreamName: 'errors',
            removalPolicy: RemovalPolicy.DESTROY
        });
        
        /**
        * A Lambda function is required to decompress
        * CloudWatch logs so they're in a compatible
        * format with Splunk (or Elasticsearch).
        */
        const cloudwatchTransformer = new Function(this, 'CloudWatchTransformer', {
            timeout: Duration.minutes(5),
            code: Code.fromAsset(join(__dirname, '..', 'lambda', 'cloudwatch-log-group-processor')),
            handler: 'cloudwatch-log-group-processor.handler',
            runtime: Runtime.NODEJS_14_X
        });
        
        /**
        * Kinesis Delivery Stream IAM Role and permissions.
        */
        const deliveryStreamRole = new Role(this, 'DeliveryStreamRole', {
            assumedBy: new ServicePrincipal('firehose.amazonaws.com'),
            inlinePolicies: {
                'Ingest': new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            resources: [ingestStream.streamArn],
                            actions: ['kinesis:DescribeStream', 'kinesis:GetShardIterator', 'kinesis:GetRecords'],
                        })
                    ]
                })
            }
        });
        backupBucket.grantWrite(deliveryStreamRole);
        cloudwatchTransformer.grantInvoke(deliveryStreamRole);
        kinesisDeliveryStreamLogs.grantWrite(deliveryStreamRole);
        
        const splunkDeliveryStream = new CfnDeliveryStream(this, 'DeliveryStream', {
            deliveryStreamType: 'KinesisStreamAsSource',
            kinesisStreamSourceConfiguration: {
                kinesisStreamArn: ingestStream.streamArn,
                roleArn: deliveryStreamRole.roleArn
            },
            splunkDestinationConfiguration: {
                cloudWatchLoggingOptions: {
                    logGroupName: kinesisDeliveryStreamLogs.logGroupName,
                    logStreamName: kinesisErrorsLogStream.logStreamName,
                    enabled: true
                },
                processingConfiguration: {
                    enabled: true,
                    processors: [
                        {
                            type: 'Lambda',
                            parameters: [
                                {
                                    parameterName: 'LambdaArn',
                                    parameterValue: cloudwatchTransformer.functionArn
                                },
                                {
                                    parameterName: 'RoleArn',
                                    parameterValue: deliveryStreamRole.roleArn
                                }
                            ]
                        }
                    ]
                },
                hecEndpoint: props.hecEndpoint,
                hecEndpointType: 'Raw',
                hecToken: props.hecToken.toString(),
                s3Configuration: {
                    bucketArn: backupBucket.bucketArn,
                    roleArn: deliveryStreamRole.roleArn
                }
            }
        });

        // The IAM policy must be in place before the delivery stream is created so it can read the ingest stream.
        splunkDeliveryStream.addDependsOn(deliveryStreamRole.node.defaultChild as CfnResource);
        
    }
}
