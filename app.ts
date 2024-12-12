import * as cdk from 'aws-cdk-lib';
import { MicroserviceDeploymentStack } from "./microservice-stack";

const app = new cdk.App();
new MicroserviceDeploymentStack(app, 'MicroserviceDeploymentStack', {
  env: { 
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  }
});