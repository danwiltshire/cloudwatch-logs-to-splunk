import { join } from 'path';
import { RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AwsLogDriverMode, Cluster, ContainerImage, LogDriver} from 'aws-cdk-lib/aws-ecs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Peer, Port, Vpc } from 'aws-cdk-lib/aws-ec2';
import { getPublicIp } from '../functions/get-public-ip';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { HostedZone } from 'aws-cdk-lib/aws-route53';
import { CloudWatchToSplunk } from '../constructs/CloudWatchToSplunk';
import { SplunkService } from '../constructs/SplunkService';

interface CloudWatchLogsToSplunkStackProps extends StackProps {
  /**
   * The domain name of the Route53
   * Hosted Zone that service DNS
   * records will be created in.
   */
  readonly hostedZoneDomainName: string
}

export class CloudwatchLogsToSplunkStack extends Stack {
  constructor(scope: Construct, id: string, props: CloudWatchLogsToSplunkStackProps) {
    super(scope, id, props);
    
    /**
     * A VPC for this application.
     */
    const vpc = new Vpc(this, 'Vpc');
    
    /**
     * Logs for all supported services
     * should be sent to this Log Group.
     */
    const logGroup = new LogGroup(this, 'LogGroup', {
      removalPolicy: RemovalPolicy.DESTROY,
      retention: RetentionDays.ONE_DAY
    });
    
    /**
     * A ECS log driver configuration
     * for all supported services.
     */
    const logDriver = LogDriver.awsLogs({
      streamPrefix: 'ecs',
      logGroup: logGroup,
      mode: AwsLogDriverMode.NON_BLOCKING,
    });
    
    /**
     * An ECS cluster that groups our
     * services together.
     */
    const cluster = new Cluster(this, 'Cluster', {
      vpc: vpc
    });
    
    /**
     * Use an existing hosted zone.
     */
    const hostedZone = HostedZone.fromLookup(this, 'HostedZone', {
      domainName: props.hostedZoneDomainName
    });

    /**
     * The Splunk service.
     * We're creating this here for PoC purposes.
     * 
     * Once Splunk has been deployed you must
     * enable indexer acknowledgement. This is
     * a manual process and is outside of this
     * project scope.
     */
    const splunkService = new SplunkService(this, 'SplunkService', {
      cluster: cluster,
      domainName: `splunk.${hostedZone.zoneName}`,
      hostedZone: hostedZone,
      logDriver: logDriver
    });    

    /**
     * Our Splunk service is in public subnets
     * but is IP restricted.  Only permit access
     * from Kinesis in Ireland.  These IPs may
     * change and there are probably better ways
     * to achieve this.
     */
    splunkService.loadBalancer.connections.allowFrom(Peer.ipv4('34.241.197.32/27'), Port.tcp(splunkService.SPLUNK_HEC_PORT), 'Kinesis Ireland');
    splunkService.loadBalancer.connections.allowFrom(Peer.ipv4('34.241.197.64/27'), Port.tcp(splunkService.SPLUNK_HEC_PORT), 'Kinesis Ireland');
    splunkService.loadBalancer.connections.allowFrom(Peer.ipv4('34.241.197.96/27'), Port.tcp(splunkService.SPLUNK_HEC_PORT), 'Kinesis Ireland');
    
    /**
     * An example application that sends
     * logs to CloudWatch and eventually
     * be sent to Splunk.
     */
    const nginxService = new ApplicationLoadBalancedFargateService(this, 'NginxService', {
      openListener: false,
      cluster: cluster,
      taskImageOptions: {
        image: ContainerImage.fromAsset(join(__dirname, '..', 'nginx')),
        containerName: 'nginx',
        containerPort: 80,
        logDriver: logDriver
      }
    });

    // Speed up deployments by killing off old containers sooner
    nginxService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '5');

    // Only allow access from our public IP.
    getPublicIp().then(ip => {
      // Splunk
      splunkService.loadBalancer.connections.allowFrom(Peer.ipv4(`${ip}/32`), Port.tcp(splunkService.SPLUNK_WEB_PORT));
      splunkService.loadBalancer.connections.allowFrom(Peer.ipv4(`${ip}/32`), Port.tcp(splunkService.SPLUNK_HEC_PORT));
      // Nginx
      nginxService.loadBalancer.connections.allowFrom(Peer.ipv4(`${ip}/32`), Port.tcp(80));
    });

    /**
     * Send our Log Groups to Splunk.
     */
    new CloudWatchToSplunk(this, 'CloudWatchToSplunk', {
      hecEndpoint: `https://splunk.${hostedZone.zoneName}:${splunkService.SPLUNK_HEC_PORT}`,
      hecToken: splunkService.hecToken,
      logGroups: [logGroup]
    });
    
  }
}
