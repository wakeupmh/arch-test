import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export class MicroserviceDeploymentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // VPC para o cluster
    const vpc = new ec2.Vpc(this, 'MicroserviceVPC', {
      maxAzs: 2,
      natGateways: 1
    });

    // Repositório ECR para nossa imagem Docker
    const repository = new ecr.Repository(this, 'MicroserviceRepository', {
      repositoryName: 'node-data-microservice',
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Cluster EKS
    const cluster = new eks.Cluster(this, 'MicroserviceCluster', {
      vpc,
      version: eks.KubernetesVersion.V1_27,
      defaultCapacity: 2,
      defaultCapacityInstance: ec2.InstanceType.of(
        ec2.InstanceClass.T3, 
        ec2.InstanceSize.MEDIUM
      )
    });

    // Segredo para configurações do microserviço
    const microserviceConfig = new secretsmanager.Secret(this, 'MicroserviceConfig', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          DATABASE_URL: 'placeholder',
          REDIS_URL: 'placeholder'
        }),
        generateStringKey: 'generated'
      }
    });

    // Projeto CodeBuild para construir e fazer push da imagem Docker
    const buildProject = new codebuild.Project(this, 'MicroserviceBuildProject', {
      vpc,
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': {
              nodejs: 20
            }
          },
          pre_build: {
            commands: [
              'echo Logging in to Amazon ECR...',
              'aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com'
            ]
          },
          build: {
            commands: [
              'echo Build started on `date`',
              'docker build -t $REPOSITORY_URI:latest .',
              'docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION'
            ]
          },
          post_build: {
            commands: [
              'echo Build completed, pushing images...',
              'docker push $REPOSITORY_URI:latest',
              'docker push $REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION',
              'echo Updating kube config...',
              'aws eks update-kubeconfig --name $EKS_CLUSTER_NAME --region $AWS_DEFAULT_REGION',
              'echo Deploying to EKS...',
              'kubectl apply -f deployment.yaml',
              'kubectl set image deployment/data-microservice microservice=$REPOSITORY_URI:$CODEBUILD_RESOLVED_SOURCE_VERSION'
            ]
          }
        }
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        privileged: true,
        environmentVariables: {
          REPOSITORY_URI: { value: repository.repositoryUri },
          EKS_CLUSTER_NAME: { value: cluster.clusterName }
        }
      }
    });

    // Permissões para o CodeBuild
    repository.grantPullPush(buildProject);
    cluster.awsAuth.addMastersRole(buildProject.role);

    // Pipeline de CI/CD
    const sourceOutput = new codepipeline.Artifact();
    const sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: 'GitHub_Source',
      owner: 'seu-usuario',
      repo: 'microservice-repo',
      oauthToken: cdk.SecretValue.secretsManager('github-token'),
      output: sourceOutput,
      branch: 'main'
    });

    const buildAction = new codepipeline_actions.CodeBuildAction({
      actionName: 'CodeBuild',
      project: buildProject,
      input: sourceOutput
    });

    new codepipeline.Pipeline(this, 'MicroservicePipeline', {
      stages: [
        {
          stageName: 'Source',
          actions: [sourceAction]
        },
        {
          stageName: 'Build',
          actions: [buildAction]
        }
      ]
    });

    // Outputs úteis
    new cdk.CfnOutput(this, 'ECRRepositoryUri', { 
      value: repository.repositoryUri 
    });
    new cdk.CfnOutput(this, 'EKSClusterName', { 
      value: cluster.clusterName 
    });
  }
}