#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CloudwatchLogsToSplunkStack } from '../lib/cloudwatch-logs-to-splunk-stack';

const app = new cdk.App();
new CloudwatchLogsToSplunkStack(app, 'CloudwatchLogsToSplunkStack', {
  env: {
    account: 'XXXXXXXXXXX',
    region: 'eu-west-1'
  },
  hostedZoneDomainName: 'XXXXXXXXXX'
});
