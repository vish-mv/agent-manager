// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package api

import (

	"github.com/wso2/agent-manager/agent-manager-service/controllers"
	"github.com/wso2/agent-manager/agent-manager-service/middleware"
)

// RegisterAgentAPIKeyRoutes registers API key routes for agents
func RegisterAgentAPIKeyRoutes(rr *middleware.RouteRegistrar, ctrl controllers.AgentAPIKeyController) {
	rr.HandleFuncWithValidation("POST /orgs/{orgName}/projects/{projName}/agents/{agentName}/environments/{envID}/api-keys", ctrl.CreateAPIKey)
	rr.HandleFuncWithValidation("POST /orgs/{orgName}/projects/{projName}/agents/{agentName}/environments/{envID}/api-keys/test", ctrl.IssueTestAPIKey)
	rr.HandleFuncWithValidation("GET /orgs/{orgName}/projects/{projName}/agents/{agentName}/environments/{envID}/api-keys", ctrl.ListAPIKeys)
	rr.HandleFuncWithValidation("DELETE /orgs/{orgName}/projects/{projName}/agents/{agentName}/environments/{envID}/api-keys/{keyName}", ctrl.RevokeAPIKey)
	rr.HandleFuncWithValidation("PUT /orgs/{orgName}/projects/{projName}/agents/{agentName}/environments/{envID}/api-keys/{keyName}", ctrl.RotateAPIKey)
}
