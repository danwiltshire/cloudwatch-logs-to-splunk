# cloudwatch-logs-to-splunk

A CDK construct that sends CloudWatch Logs to Splunk via Kinesis Streams and Firehose.

This CDK project also deploys a Splunk service in a container for testing purposes.
The HTTP Event Collector token is hard coded and you'll probably need to replace it
with a better solution.

It can take a while for Kinesis to send logs to Splunk when the stack is initially
deployed.  Please be patient but note that this has only been tested in the `eu-west-1`
AWS region.  We are adding Kinesis IP addresses for Ireland to an allowlist.  Again,
this needs a better solution for production.

An example nginx service will also be deployed.  It purposely outputs JSON as well
as standard raw text to give you an example of what to expect (hint, JSON is parsed
automatically by CloudWatch and Splunk) - it just works.

I have noticed an issue where Splunk is joining some lines unexpectedly.  It's
possible the Splunk configuration needs amending to support receiving a mix of
JSON and raw text.

## Development

1. Clone this repository
2. `npm install`

## Testing

1. `npm run test`

## Deployment

1. Fill in account details in [bin/cloudwatch-logs-to-splunk.ts](bin/cloudwatch-logs-to-splunk.ts)
2. `npx cdk deploy`
