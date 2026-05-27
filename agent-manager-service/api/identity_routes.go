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
	"github.com/wso2/agent-manager/agent-manager-service/rbac"
)

func registerIdentityRoutes(rr *middleware.RouteRegistrar, ctrl controllers.IdentityController) {
	// Users
	rr.HandleFuncWithValidationAndAnyAuthz("GET /orgs/{orgName}/identities/users", ctrl.ListUsers, rbac.OrgInviteMember, rbac.OrgRemoveMember)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/users/invite", rbac.OrgInviteMember, ctrl.InviteUser)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/users", rbac.OrgInviteMember, ctrl.CreateUser)
	rr.HandleFuncWithValidationAndAnyAuthz("GET /orgs/{orgName}/identities/users/{userID}", ctrl.GetUser, rbac.OrgInviteMember, rbac.OrgRemoveMember)
	rr.HandleFuncWithValidationAndAuthz("PUT /orgs/{orgName}/identities/users/{userID}", rbac.OrgInviteMember, ctrl.UpdateUser)
	rr.HandleFuncWithValidationAndAuthz("DELETE /orgs/{orgName}/identities/users/{userID}", rbac.OrgRemoveMember, ctrl.DeleteUser)
	rr.HandleFuncWithValidationAndAnyAuthz("GET /orgs/{orgName}/identities/users/{userID}/groups", ctrl.GetUserGroups, rbac.OrgInviteMember, rbac.OrgRemoveMember)
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/users/{userID}/roles", rbac.RoleRead, ctrl.GetUserRoles)

	// Groups
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/groups", rbac.GroupRead, ctrl.ListGroups)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/groups", rbac.GroupCreate, ctrl.CreateGroup)
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/groups/{groupID}", rbac.GroupRead, ctrl.GetGroup)
	rr.HandleFuncWithValidationAndAuthz("PUT /orgs/{orgName}/identities/groups/{groupID}", rbac.GroupUpdate, ctrl.UpdateGroup)
	rr.HandleFuncWithValidationAndAuthz("DELETE /orgs/{orgName}/identities/groups/{groupID}", rbac.GroupDelete, ctrl.DeleteGroup)
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/groups/{groupID}/members", rbac.GroupRead, ctrl.GetGroupMembers)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/groups/{groupID}/members/add", rbac.GroupUpdate, ctrl.AddGroupMembers)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/groups/{groupID}/members/remove", rbac.GroupUpdate, ctrl.RemoveGroupMembers)
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/groups/{groupID}/roles", rbac.GroupRead, ctrl.GetGroupRoles)

	// Roles
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/roles", rbac.RoleRead, ctrl.ListRoles)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/roles", rbac.RoleCreate, ctrl.CreateRole)
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/roles/{roleID}", rbac.RoleRead, ctrl.GetRole)
	rr.HandleFuncWithValidationAndAuthz("PUT /orgs/{orgName}/identities/roles/{roleID}", rbac.RoleUpdate, ctrl.UpdateRole)
	rr.HandleFuncWithValidationAndAuthz("DELETE /orgs/{orgName}/identities/roles/{roleID}", rbac.RoleDelete, ctrl.DeleteRole)
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/roles/{roleID}/assignments", rbac.RoleRead, ctrl.GetRoleAssignments)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/roles/{roleID}/permissions/add", rbac.RoleUpdate, ctrl.AddRolePermissions)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/roles/{roleID}/permissions/remove", rbac.RoleUpdate, ctrl.RemoveRolePermissions)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/roles/{roleID}/assignees/add", rbac.RoleUpdate, ctrl.AddRoleAssignees)
	rr.HandleFuncWithValidationAndAuthz("POST /orgs/{orgName}/identities/roles/{roleID}/assignees/remove", rbac.RoleUpdate, ctrl.RemoveRoleAssignees)

	// Permissions catalog
	rr.HandleFuncWithValidationAndAuthz("GET /orgs/{orgName}/identities/permissions", rbac.RoleRead, ctrl.ListAMPPermissions)
}
