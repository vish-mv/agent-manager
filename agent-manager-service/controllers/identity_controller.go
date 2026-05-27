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

package controllers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/wso2/agent-manager/agent-manager-service/clients/thundersvc"
	"github.com/wso2/agent-manager/agent-manager-service/middleware"
	"github.com/wso2/agent-manager/agent-manager-service/middleware/logger"
	"github.com/wso2/agent-manager/agent-manager-service/utils"
)

// IdentityController defines HTTP handlers for user, group, and role management.
type IdentityController interface {
	// Users
	ListUsers(w http.ResponseWriter, r *http.Request)
	GetUser(w http.ResponseWriter, r *http.Request)
	CreateUser(w http.ResponseWriter, r *http.Request)
	UpdateUser(w http.ResponseWriter, r *http.Request)
	DeleteUser(w http.ResponseWriter, r *http.Request)
	GetUserGroups(w http.ResponseWriter, r *http.Request)
	GetUserRoles(w http.ResponseWriter, r *http.Request)
	InviteUser(w http.ResponseWriter, r *http.Request)

	// Groups
	ListGroups(w http.ResponseWriter, r *http.Request)
	GetGroup(w http.ResponseWriter, r *http.Request)
	CreateGroup(w http.ResponseWriter, r *http.Request)
	UpdateGroup(w http.ResponseWriter, r *http.Request)
	DeleteGroup(w http.ResponseWriter, r *http.Request)
	AddGroupMembers(w http.ResponseWriter, r *http.Request)
	RemoveGroupMembers(w http.ResponseWriter, r *http.Request)
	GetGroupMembers(w http.ResponseWriter, r *http.Request)
	GetGroupRoles(w http.ResponseWriter, r *http.Request)

	// Roles
	ListRoles(w http.ResponseWriter, r *http.Request)
	GetRole(w http.ResponseWriter, r *http.Request)
	CreateRole(w http.ResponseWriter, r *http.Request)
	UpdateRole(w http.ResponseWriter, r *http.Request)
	DeleteRole(w http.ResponseWriter, r *http.Request)
	GetRoleAssignments(w http.ResponseWriter, r *http.Request)
	AddRolePermissions(w http.ResponseWriter, r *http.Request)
	RemoveRolePermissions(w http.ResponseWriter, r *http.Request)
	AddRoleAssignees(w http.ResponseWriter, r *http.Request)
	RemoveRoleAssignees(w http.ResponseWriter, r *http.Request)

	// Permissions catalog
	ListAMPPermissions(w http.ResponseWriter, r *http.Request)
}

type identityController struct {
	client thundersvc.IdentityClient
}

// NewIdentityController creates a new identity controller.
func NewIdentityController(client thundersvc.IdentityClient) IdentityController {
	return &identityController{client: client}
}

// --- Users ---

func (c *identityController) ListUsers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	org, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to resolve organization unit")
		return
	}

	offset := getIntQueryParam(r, "offset", 0)
	limit := getIntQueryParam(r, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	users, total, err := c.client.ListUsersByOUHandle(ctx, org.Name, offset, limit)
	if err != nil {
		log.Error("ListUsers failed", "ouHandle", org.Name, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list users")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"users": users, "total": total, "offset": offset, "limit": limit})
}

func (c *identityController) GetUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	user, err := c.client.GetUser(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("GetUser failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get user")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, user)
}

func (c *identityController) CreateUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	org, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to resolve organization unit")
		return
	}

	var body struct {
		Username   string                    `json:"username"`
		Type       string                    `json:"type"`
		Claims     []thundersvc.ThunderClaim `json:"claims,omitempty"`
		Credential thundersvc.ThunderCred    `json:"credential"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Username == "" {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "username is required")
		return
	}
	if strings.TrimSpace(body.Credential.Password) == "" {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "password is required")
		return
	}

	ouID := org.OUID

	attrs := map[string]string{"username": body.Username}
	for _, claim := range body.Claims {
		if claim.Value != "" {
			attrs[claim.Type] = claim.Value
		}
	}

	userType := body.Type
	if userType == "" {
		userType = "engineer"
	}

	req := thundersvc.CreateUserRequest{
		OuID:       ouID,
		Type:       userType,
		Attributes: attrs,
		Password:   body.Credential.Password,
	}

	user, err := c.client.CreateUser(ctx, req)
	if err != nil {
		log.Error("CreateUser failed", "username", body.Username, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to create user")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusCreated, user)
}

func (c *identityController) UpdateUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	var req thundersvc.UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	user, err := c.client.UpdateUser(ctx, userID, req)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("UpdateUser failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update user")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, user)
}

func (c *identityController) DeleteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	if err := c.client.DeleteUser(ctx, userID); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("DeleteUser failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to delete user")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (c *identityController) GetUserGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	groups, err := c.client.GetUserGroups(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("GetUserGroups failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get user groups")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"groups": groups})
}

func (c *identityController) GetUserRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	roles, err := c.client.GetUserRoles(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("GetUserRoles failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get user roles")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"roles": roles})
}

func (c *identityController) InviteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	var body struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if body.Email == "" {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "email is required")
		return
	}

	inviteLink, err := c.client.InviteUser(ctx, body.Email)
	if err != nil {
		log.Error("InviteUser failed", "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to invite user")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]string{"inviteLink": inviteLink})
}

// --- Groups ---

func (c *identityController) ListGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	org, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to resolve organization unit")
		return
	}

	offset := getIntQueryParam(r, "offset", 0)
	limit := getIntQueryParam(r, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	groups, total, err := c.client.ListGroups(ctx, org.OUID, offset, limit)
	if err != nil {
		log.Error("ListGroups failed", "ouID", org.OUID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list groups")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"groups": groups, "total": total, "offset": offset, "limit": limit})
}

func (c *identityController) GetGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("GetGroup failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get group")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, group)
}

func (c *identityController) CreateGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	org, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to resolve organization unit")
		return
	}

	var req thundersvc.CreateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.Name == "" {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "name is required")
		return
	}
	req.OuID = org.OUID

	group, err := c.client.CreateGroup(ctx, req)
	if err != nil {
		log.Error("CreateGroup failed", "name", req.Name, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to create group")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusCreated, group)
}

func (c *identityController) UpdateGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	var req thundersvc.UpdateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	group, err := c.client.UpdateGroup(ctx, groupID, req)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("UpdateGroup failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update group")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, group)
}

func (c *identityController) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	if err := c.client.DeleteGroup(ctx, groupID); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("DeleteGroup failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to delete group")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (c *identityController) AddGroupMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	var req struct {
		UserIDs []string `json:"userIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(req.UserIDs) == 0 {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "userIds must not be empty")
		return
	}

	if err := c.client.AddGroupMembers(ctx, groupID, req.UserIDs); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("AddGroupMembers failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to add group members")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, struct{}{})
}

func (c *identityController) RemoveGroupMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	var req struct {
		UserIDs []string `json:"userIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if len(req.UserIDs) == 0 {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "userIds must not be empty")
		return
	}

	if err := c.client.RemoveGroupMembers(ctx, groupID, req.UserIDs); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("RemoveGroupMembers failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to remove group members")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, struct{}{})
}

func (c *identityController) GetGroupMembers(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	offset := getIntQueryParam(r, "offset", 0)
	limit := getIntQueryParam(r, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	members, total, err := c.client.GetGroupMembers(ctx, groupID, offset, limit)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("GetGroupMembers failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get group members")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"users": members, "total": total, "offset": offset, "limit": limit})
}

func (c *identityController) GetGroupRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	roles, err := c.client.GetGroupRoles(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("GetGroupRoles failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get group roles")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"roles": roles})
}

// --- Roles ---

func (c *identityController) ListRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	org, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to resolve organization unit")
		return
	}

	offset := getIntQueryParam(r, "offset", 0)
	limit := getIntQueryParam(r, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	roles, total, err := c.client.ListRoles(ctx, org.OUID, offset, limit)
	if err != nil {
		log.Error("ListRoles failed", "ouID", org.OUID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list roles")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"roles": roles, "total": total, "offset": offset, "limit": limit})
}

func (c *identityController) GetRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("GetRole failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get role")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, role)
}

func (c *identityController) CreateRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	org, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to resolve organization unit")
		return
	}

	var req thundersvc.CreateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}
	if req.Name == "" {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "name is required")
		return
	}
	req.OuID = org.OUID

	role, err := c.client.CreateRole(ctx, req)
	if err != nil {
		log.Error("CreateRole failed", "name", req.Name, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to create role")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusCreated, role)
}

func (c *identityController) UpdateRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	var req thundersvc.UpdateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	role, err := c.client.UpdateRole(ctx, roleID, req)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("UpdateRole failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update role")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, role)
}

func (c *identityController) DeleteRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	if err := c.client.DeleteRole(ctx, roleID); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("DeleteRole failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to delete role")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (c *identityController) GetRoleAssignments(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	assignments, err := c.client.GetRoleAssignments(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("GetRoleAssignments failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get role assignments")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, assignments)
}

func (c *identityController) AddRolePermissions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	var req thundersvc.RolePermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.AddRolePermissions(ctx, roleID, req); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("AddRolePermissions failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to add role permissions")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, struct{}{})
}

func (c *identityController) RemoveRolePermissions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	var req thundersvc.RolePermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.RemoveRolePermissions(ctx, roleID, req); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("RemoveRolePermissions failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to remove role permissions")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, struct{}{})
}

func (c *identityController) AddRoleAssignees(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	req, err := decodeRoleAssigneeRequest(r)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.AddRoleAssignees(ctx, roleID, req); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("AddRoleAssignees failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to add role assignees")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, struct{}{})
}

func (c *identityController) RemoveRoleAssignees(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	req, err := decodeRoleAssigneeRequest(r)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.RemoveRoleAssignees(ctx, roleID, req); err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("RemoveRoleAssignees failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to remove role assignees")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, struct{}{})
}

// decodeRoleAssigneeRequest converts the frontend { userIds, groupIds } payload
// into the Thunder { assignments: [{type, id}] } format.
func decodeRoleAssigneeRequest(r *http.Request) (thundersvc.RoleAssignmentsRequest, error) {
	var body struct {
		UserIDs  []string `json:"userIds"`
		GroupIDs []string `json:"groupIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return thundersvc.RoleAssignmentsRequest{}, err
	}
	var entries []thundersvc.AssignmentEntry
	for _, id := range body.UserIDs {
		entries = append(entries, thundersvc.AssignmentEntry{ID: id, Type: "user"})
	}
	for _, id := range body.GroupIDs {
		entries = append(entries, thundersvc.AssignmentEntry{ID: id, Type: "group"})
	}
	if len(entries) == 0 {
		return thundersvc.RoleAssignmentsRequest{}, errors.New("at least one userId or groupId is required")
	}
	return thundersvc.RoleAssignmentsRequest{Assignments: entries}, nil
}

// --- Permissions catalog ---

func (c *identityController) ListAMPPermissions(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	perms, rsID, err := c.client.ListAMPPermissions(ctx)
	if err != nil {
		log.Error("ListAMPPermissions failed", "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list AMP permissions")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"permissions": perms, "resourceServerId": rsID})
}
