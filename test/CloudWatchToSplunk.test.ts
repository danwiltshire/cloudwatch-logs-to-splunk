import { App, SecretValue, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { CloudWatchToSplunk } from "../constructs/CloudWatchToSplunk";

describe('CloudWatchToSplunk', () => {
    // GIVEN
    const app = new App();
    const stack = new Stack(app);
    new CloudWatchToSplunk(stack, 'CloudWatchToSplunk', {
        hecEndpoint: 'https://my-endpoint:8088',
        hecToken: SecretValue.plainText('value'),
        logGroups: [new LogGroup(stack, 'LogGroup')]
    });
    
    // WHEN
    const template = Template.fromStack(stack);
    
    // THEN
    test('A Kinesis Stream is created', () => {
        template.hasResourceProperties('AWS::Kinesis::Stream', {
            "RetentionPeriodHours": 24,
            "StreamEncryption": {
                "Fn::If": [
                    "AwsCdkKinesisEncryptedStreamsUnsupportedRegions",
                    {
                        "Ref": "AWS::NoValue"
                    },
                    {
                        "EncryptionType": "KMS",
                        "KeyId": "alias/aws/kinesis"
                    }
                ]
            },
            "StreamModeDetails": {
                "StreamMode": "ON_DEMAND"
            }
        });
    });
    test('A Kinesis Delivery Stream is created', () => {
        template.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
            "DeliveryStreamType": "KinesisStreamAsSource",
            "KinesisStreamSourceConfiguration": {
                "KinesisStreamARN": {
                    "Fn::GetAtt": [
                        "CloudWatchToSplunkIngestStreamEDBBB485",
                        "Arn"
                    ]
                },
                "RoleARN": {
                    "Fn::GetAtt": [
                        "CloudWatchToSplunkDeliveryStreamRoleEED35E26",
                        "Arn"
                    ]
                }
            },
            "SplunkDestinationConfiguration": {
                "CloudWatchLoggingOptions": {
                    "Enabled": true,
                    "LogGroupName": {
                        "Ref": "CloudWatchToSplunkKinesisDeliveryStreamLogs70B45412"
                    },
                    "LogStreamName": {
                        "Ref": "CloudWatchToSplunkKinesisErrorLogStream2336F476"
                    }
                },
                "HECEndpoint": "https://my-endpoint:8088",
                "HECEndpointType": "Raw",
                "HECToken": "value",
                "ProcessingConfiguration": {
                    "Enabled": true,
                    "Processors": [
                        {
                            "Parameters": [
                                {
                                    "ParameterName": "LambdaArn",
                                    "ParameterValue": {
                                        "Fn::GetAtt": [
                                            "CloudWatchToSplunkCloudWatchTransformer06E20F66",
                                            "Arn"
                                        ]
                                    }
                                },
                                {
                                    "ParameterName": "RoleArn",
                                    "ParameterValue": {
                                        "Fn::GetAtt": [
                                            "CloudWatchToSplunkDeliveryStreamRoleEED35E26",
                                            "Arn"
                                        ]
                                    }
                                }
                            ],
                            "Type": "Lambda"
                        }
                    ]
                },
                "S3Configuration": {
                    "BucketARN": {
                        "Fn::GetAtt": [
                            "CloudWatchToSplunkBackupBucket60714977",
                            "Arn"
                        ]
                    },
                    "RoleARN": {
                        "Fn::GetAtt": [
                            "CloudWatchToSplunkDeliveryStreamRoleEED35E26",
                            "Arn"
                        ]
                    }
                }
            }
        });
    });
    test('A Subcription Filter is created', () => {
        template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
            "DestinationArn": {
                "Fn::GetAtt": [
                    "CloudWatchToSplunkIngestStreamEDBBB485",
                    "Arn"
                ]
            },
            "FilterPattern": "",
            "LogGroupName": {
                "Ref": "LogGroupF5B46931"
            },
            "RoleArn": {
                "Fn::GetAtt": [
                    "LogGroupkinesisCloudWatchLogsCanPutRecordsA8576A95",
                    "Arn"
                ]
            }        
        });
    });
    test('A failed delivery event bucket is created', () => {
        template.hasResourceProperties('AWS::S3::Bucket', {
            "Tags": [
                {
                    "Key": "aws-cdk:auto-delete-objects",
                    "Value": "true"
                }
            ]
        });
    });
    test('A log group for Kinesis errors is created', () => {
        template.hasResourceProperties('AWS::Logs::LogGroup', {
            "RetentionInDays": 1
        });
    });
    test('A log stream for Kinesis errors is created', () => {
        template.hasResourceProperties('AWS::Logs::LogStream', {
            "LogGroupName": {
                "Ref": "CloudWatchToSplunkKinesisDeliveryStreamLogs70B45412"
            },
            "LogStreamName": "errors"
        });
    });
    test('A Lambda function for CloudWatch log decompression is created', () => {
        template.hasResourceProperties('AWS::Lambda::Function', {
            "Role": {
                "Fn::GetAtt": [
                    "CloudWatchToSplunkCloudWatchTransformerServiceRole7183E350",
                    "Arn"
                ]
            },
            "Handler": "cloudwatch-log-group-processor.handler",
            "Runtime": "nodejs14.x",
            "Timeout": 300
        });
    });
    test('An IAM Role for the delivery stream is created', () => {
        template.hasResourceProperties('AWS::IAM::Role', {
            "AssumeRolePolicyDocument": {
                "Statement": [
                    {
                        "Action": "sts:AssumeRole",
                        "Effect": "Allow",
                        "Principal": {
                            "Service": "firehose.amazonaws.com"
                        }
                    }
                ],
                "Version": "2012-10-17"
            },
            "Policies": [
                {
                    "PolicyDocument": {
                        "Statement": [
                            {
                                "Action": [
                                    "kinesis:DescribeStream",
                                    "kinesis:GetShardIterator",
                                    "kinesis:GetRecords"
                                ],
                                "Effect": "Allow",
                                "Resource": {
                                    "Fn::GetAtt": [
                                        "CloudWatchToSplunkIngestStreamEDBBB485",
                                        "Arn"
                                    ]
                                }
                            }
                        ],
                        "Version": "2012-10-17"
                    },
                    "PolicyName": "Ingest"
                }
            ]
        });
    });
    test('An IAM Inline Policy for the delivery stream is created', () => {
        template.hasResourceProperties('AWS::IAM::Policy', {
            "PolicyDocument": {
                "Statement": [
                    {
                        "Action": [
                            "s3:DeleteObject*",
                            "s3:PutObject",
                            "s3:PutObjectLegalHold",
                            "s3:PutObjectRetention",
                            "s3:PutObjectTagging",
                            "s3:PutObjectVersionTagging",
                            "s3:Abort*"
                        ],
                        "Effect": "Allow",
                        "Resource": [
                            {
                                "Fn::GetAtt": [
                                    "CloudWatchToSplunkBackupBucket60714977",
                                    "Arn"
                                ]
                            },
                            {
                                "Fn::Join": [
                                    "",
                                    [
                                        {
                                            "Fn::GetAtt": [
                                                "CloudWatchToSplunkBackupBucket60714977",
                                                "Arn"
                                            ]
                                        },
                                        "/*"
                                    ]
                                ]
                            }
                        ]
                    },
                    {
                        "Action": "lambda:InvokeFunction",
                        "Effect": "Allow",
                        "Resource": [
                            {
                                "Fn::GetAtt": [
                                    "CloudWatchToSplunkCloudWatchTransformer06E20F66",
                                    "Arn"
                                ]
                            },
                            {
                                "Fn::Join": [
                                    "",
                                    [
                                        {
                                            "Fn::GetAtt": [
                                                "CloudWatchToSplunkCloudWatchTransformer06E20F66",
                                                "Arn"
                                            ]
                                        },
                                        ":*"
                                    ]
                                ]
                            }
                        ]
                    },
                    {
                        "Action": [
                            "logs:CreateLogStream",
                            "logs:PutLogEvents"
                        ],
                        "Effect": "Allow",
                        "Resource": {
                            "Fn::GetAtt": [
                                "CloudWatchToSplunkKinesisDeliveryStreamLogs70B45412",
                                "Arn"
                            ]
                        }
                    }
                ],
                "Version": "2012-10-17"
            },
            "PolicyName": "CloudWatchToSplunkDeliveryStreamRoleDefaultPolicy3B2CD13C",
            "Roles": [
                {
                    "Ref": "CloudWatchToSplunkDeliveryStreamRoleEED35E26"
                }
            ]
        });
    });
});
