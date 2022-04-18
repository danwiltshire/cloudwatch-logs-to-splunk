import { Duration, SecretValue } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Secret, SecretStringValueBeta1 } from 'aws-cdk-lib/aws-secretsmanager';
import { ApplicationLoadBalancedFargateService } from 'aws-cdk-lib/aws-ecs-patterns';
import { IHostedZone } from 'aws-cdk-lib/aws-route53';
import {
    ContainerImage,
    ICluster,
    ListenerConfig,
    LogDriver,
    Secret as EcsSecret
} from 'aws-cdk-lib/aws-ecs';
import {
    ApplicationListener,
    ApplicationLoadBalancer,
    ApplicationProtocol,
    ListenerCertificate
} from 'aws-cdk-lib/aws-elasticloadbalancingv2';

interface SplunkServiceProps {
    /**
     * The Route53 Hosted Zone that the domain name
     * for the Splunk service will be created in.
     */
    readonly hostedZone: IHostedZone
    /**
     * The domain name for the service, e.g. "splunk.example.com."
     */
    readonly domainName: string
    /**
     * The ECS Fargate cluster that the service will reside in.
     */
    readonly cluster: ICluster
    /**
     * The Log Driver to use for Splunk service logs.
     */
    readonly logDriver: LogDriver
}

export class SplunkService extends Construct {
    
    /**
     * The port that the Splunk Web interface will listen on.
     */
    public readonly SPLUNK_WEB_PORT = 8000;
    /**
     * The port that the Splunk HTTP Event Collector will listen on.
     */
    public readonly SPLUNK_HEC_PORT = 8088;
    /**
     * The Application Load Balancer for the service.
     */
    public readonly loadBalancer: ApplicationLoadBalancer;
    /**
     * The Splunk HTTP Event Collector token.
     */
    public readonly hecToken: SecretValue
    
    /**
    * Creates a Splunk service in AWS ECS Fargate.
    */
    constructor(scope: Construct, id: string, props: SplunkServiceProps) {
        super(scope, id);
        
        const splunkWebPassword = new Secret(this, 'SplunkSecret', {
            generateSecretString: {
                excludePunctuation: true
            }
        });
        
        const splunkHecToken = new Secret(this, 'SplunkHECTokenSecret', {
            // Example GUID. Must be valid.
            secretStringBeta1: SecretStringValueBeta1.fromUnsafePlaintext('648e84f8-5c88-4add-a34d-86207c5f6649')
        });
        
        const splunkService = new ApplicationLoadBalancedFargateService(this, 'SplunkService', {
            openListener: false,
            protocol: ApplicationProtocol.HTTPS,
            cluster: props.cluster,
            cpu: 1024,
            memoryLimitMiB: 2048,
            domainName: props.domainName,
            domainZone: props.hostedZone,
            targetProtocol: ApplicationProtocol.HTTPS,
            healthCheckGracePeriod: Duration.seconds(120),
            listenerPort: this.SPLUNK_WEB_PORT,
            circuitBreaker: {
                rollback: true
            },
            taskImageOptions: {
                containerPort: this.SPLUNK_WEB_PORT,
                image: ContainerImage.fromRegistry('splunk/splunk:8.2.6'),
                containerName: 'splunk',
                logDriver: props.logDriver,
                environment: {
                    'SPLUNK_START_ARGS': '--accept-license',
                    'SPLUNK_LICENSE_URI': 'Free',
                    'SPLUNK_HTTP_ENABLESSL': 'true'
                },
                secrets: {
                    'SPLUNK_PASSWORD': EcsSecret.fromSecretsManager(splunkWebPassword),
                    'SPLUNK_HEC_TOKEN': EcsSecret.fromSecretsManager(splunkHecToken)
                }
            }
        });
        
        // Speed up deployments by killing off old containers sooner
        splunkService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '5');
        
        // Splunk requires quite a bit of time to boot.
        splunkService.targetGroup.configureHealthCheck({
            healthyHttpCodes: '200',
            path: '/en-GB/config',
            unhealthyThresholdCount: 5,
            interval: Duration.seconds(45)
        });
        
        /**
        * HEC
        */
        splunkService.taskDefinition.defaultContainer?.addPortMappings({
            containerPort: this.SPLUNK_HEC_PORT
        });
        const listener = new ApplicationListener(this, 'SplunkHECListener', {
            protocol: ApplicationProtocol.HTTPS,
            open: false,
            port: this.SPLUNK_HEC_PORT,
            loadBalancer: splunkService.loadBalancer,
            certificates: [
                ...splunkService.certificate ? [ListenerCertificate.fromCertificateManager(splunkService.certificate)] : []
            ]
        });
        splunkService.service.registerLoadBalancerTargets({
            containerName: splunkService.taskDefinition.defaultContainer?.containerName || 'splunk',
            newTargetGroupId: 'SplunkHEC',
            containerPort: this.SPLUNK_HEC_PORT,
            listener: ListenerConfig.applicationListener(listener, {
                protocol: ApplicationProtocol.HTTPS,
                targets: [splunkService.service],
                port: this.SPLUNK_HEC_PORT,
                healthCheck: {
                    healthyHttpCodes: '200',
                    unhealthyThresholdCount: 5,
                    interval: Duration.seconds(45),
                    path: '/services/collector/health/1.0'
                }
            })
        });

        // Expose our properties for other constructs.
        this.hecToken = splunkHecToken.secretValue;
        this.loadBalancer = splunkService.loadBalancer;
        
    }
}
