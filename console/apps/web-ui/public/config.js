/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

window.__RUNTIME_CONFIG__ = {
  authConfig: {
    baseUrl: 'http://thunder.amp.localhost:8080',
    clientId: 'amp-console-client',
    organizationHandle: (''.trim() || 'default'),
    signInUrl: 'http://thunder.amp.localhost:8080/gate',
    afterSignInUrl: 'http://localhost:3000/login',
    afterSignOutUrl: 'http://localhost:3000/login',
    scopes: ('openid profile email org:view org:modify-settings org:invite-member org:remove-member org:assign-role org:manage-idp org:manage-service-account project:create project:read project:update project:delete environment:create environment:read environment:update environment:delete gateway:create gateway:read gateway:update gateway:delete gateway:token-manage data-plane:read deployment-pipeline:read git-secret:create git-secret:read git-secret:delete llm-provider-template:create llm-provider-template:read llm-provider-template:update llm-provider-template:delete llm-provider:create llm-provider:read llm-provider:update llm-provider:delete llm-provider:configure-guardrail llm-provider:connect llm-provider:deploy llm-provider:api-key-manage mcp-server:create mcp-server:read mcp-server:update mcp-server:delete mcp-server:configure-guardrail mcp-server:connect llm-proxy:create llm-proxy:read llm-proxy:update llm-proxy:delete llm-proxy:deploy llm-proxy:api-key-manage evaluator:create evaluator:read evaluator:update evaluator:delete agent:create agent:read agent:update agent:delete agent:build agent:deploy-non-production agent:deploy-production agent:promote agent:rollback agent:suspend agent:token-manage monitor:create monitor:read monitor:update monitor:delete monitor:execute monitor:score-read monitor:score-publish observability:org-dashboard observability:project-dashboard observability:guardrail-metric observability:infra-metric role:create role:read role:update role:delete group:create group:read group:update group:delete catalog:read repository:read agent-kind:read agent-kind:create agent-kind:update agent-kind:delete'.trim() || 'openid profile email').split(/\s+/).filter(Boolean),
    platform: 'AsgardeoV2',
    tokenValidation: {
      idToken: {
        // Disable for Thunder / local dev with non-standard issuers or self-signed certs
        validate: false,
        clockTolerance: 300,
      },
    },
    tokenLifecycle: {
      refreshToken: {
        autoRefresh: true,
      },
    },
    storage: 'localStorage',
  },
  disableAuth: false,
  rbacEnabled: true,
  apiBaseUrl: 'http://localhost:9000',
  obsApiBaseUrl: 'http://localhost:9098',
  gatewayControlPlaneUrl: 'http://localhost:9243',
  gatewayVersion: 'v0.11.0',
  instrumentationUrl: 'http://localhost:22893/otel',
  guardrailsCatalogUrl: 'https://db720294-98fd-40f4-85a1-cc6a3b65bc9a-prod.e1-us-east-azure.choreoapis.dev/api-platform/policy-hub-api/policy-hub-public/v1.0/policies?categories=Guardrails,AI&limit=100',
  guardrailsDefinitionBaseUrl: 'https://db720294-98fd-40f4-85a1-cc6a3b65bc9a-prod.e1-us-east-azure.choreoapis.dev/api-platform/policy-hub-api/policy-hub-public/v1.0/policies',
  guardrailCapabilities: {
    awsBedrock: false,
    azureContentSafety: false,
    graniteGuardian: false,
    nemoGuard: false,
    semanticGuardrails: false,
  },
  docsUrl: 'https://wso2.github.io/agent-manager/docs/next',
  footerLinks: {
    privacyPolicyUrl: 'https://wso2.com/agent-platform/agent-manager/',
    termsOfUseUrl: 'https://wso2.com/agent-platform/agent-manager/',
  },
  instrumentationDocLinks: {
    manualInstrumentation: '/components/amp-instrumentation/#manual-instrumentation',
    versionMapping: '/components/amp-instrumentation/#amp-instrumentation-version-mapping',
  },
};
