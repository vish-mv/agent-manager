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
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/wso2/agent-manager/agent-manager-service/clients/thundersvc"
	"github.com/wso2/agent-manager/agent-manager-service/config"
	"github.com/wso2/agent-manager/agent-manager-service/constants"
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
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

	users, total, err := c.client.ListUsersByOUId(ctx, resolvedOrg.OUID, offset, limit)
	if err != nil {
		log.Error("ListUsers failed", "ouID", resolvedOrg.OUID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list users")
		return
	}

	// Normalize user data: if Display is set but attributes is empty,
	// populate attributes with the username from Display field (from OU-scoped endpoint)
	for i := range users {
		if users[i].Display != "" && users[i].Attributes == nil {
			users[i].Attributes = map[string]any{"username": users[i].Display}
		}
	}

	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"users": users, "total": total, "offset": offset, "limit": limit})
}

func (c *identityController) GetUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

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

	if !validateUserOwnership(w, ctx, user, resolvedOrg.OUID) {
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, user)
}

func (c *identityController) CreateUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
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

	ouID := resolvedOrg.OUID

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	user, err := c.client.GetUser(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("UpdateUser failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update user")
		return
	}

	if !validateUserOwnership(w, ctx, user, resolvedOrg.OUID) {
		return
	}

	var req thundersvc.UpdateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updatedUser, err := c.client.UpdateUser(ctx, userID, req)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("UpdateUser failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update user")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, updatedUser)
}

func (c *identityController) DeleteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	userID := r.PathValue(utils.PathParamUserID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	user, err := c.client.GetUser(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("DeleteUser failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to delete user")
		return
	}

	if !validateUserOwnership(w, ctx, user, resolvedOrg.OUID) {
		return
	}

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	user, err := c.client.GetUser(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("GetUserGroups failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get user groups")
		return
	}

	if !validateUserOwnership(w, ctx, user, resolvedOrg.OUID) {
		return
	}

	groups, err := c.client.GetUserGroups(ctx, userID)
	if err != nil {
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	user, err := c.client.GetUser(ctx, userID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "User not found")
			return
		}
		log.Error("GetUserRoles failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get user roles")
		return
	}

	if !validateUserOwnership(w, ctx, user, resolvedOrg.OUID) {
		return
	}

	roles, err := c.client.GetUserRoles(ctx, userID)
	if err != nil {
		log.Error("GetUserRoles failed", "userID", userID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get user roles")
		return
	}
	for i := range roles {
		roles[i].IsReadOnly = constants.IsPredefinedRole(roles[i].Name)
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"roles": roles})
}

func (c *identityController) InviteUser(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

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

	// On-prem: Thunder's invite flow has no OU selection step (no child OUs).
	// Cloud: pass the child OU ID so Thunder scopes the invite correctly.
	ouIDForInvite := ""
	if !config.GetConfig().IsOnPremDeployment {
		ouIDForInvite = resolvedOrg.OUID
	}
	inviteLink, err := c.client.InviteUser(ctx, body.Email, ouIDForInvite)
	if err != nil {
		log.Error("InviteUser failed", "ouID", resolvedOrg.OUID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to invite user")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]string{"inviteLink": inviteLink})
}

// --- Groups ---

func (c *identityController) ListGroups(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
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

	groups, total, err := c.client.ListGroupsByOUId(ctx, resolvedOrg.OUID, offset, limit)
	if err != nil {
		log.Error("ListGroups failed", "ouID", resolvedOrg.OUID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list groups")
		return
	}

	// Populate OuID for groups from OU-scoped endpoint (they don't return it)
	for i := range groups {
		if groups[i].OuID == "" {
			groups[i].OuID = resolvedOrg.OUID
		}
	}

	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"groups": groups, "total": total, "offset": offset, "limit": limit})
}

func (c *identityController) GetGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

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

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

	utils.WriteSuccessResponse(w, http.StatusOK, group)
}

func (c *identityController) CreateGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
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
	req.OuID = resolvedOrg.OUID

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("UpdateGroup failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update group")
		return
	}

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

	var req thundersvc.UpdateGroupRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updatedGroup, err := c.client.UpdateGroup(ctx, groupID, req)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("UpdateGroup failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update group")
		return
	}
	utils.WriteSuccessResponse(w, http.StatusOK, updatedGroup)
}

func (c *identityController) DeleteGroup(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	groupID := r.PathValue(utils.PathParamGroupID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("DeleteGroup failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to delete group")
		return
	}

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("AddGroupMembers failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to add group members")
		return
	}

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("RemoveGroupMembers failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to remove group members")
		return
	}

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("GetGroupMembers failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get group members")
		return
	}

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

	offset := getIntQueryParam(r, "offset", 0)
	limit := getIntQueryParam(r, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	members, total, err := c.client.GetGroupMembers(ctx, groupID, offset, limit)
	if err != nil {
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	group, err := c.client.GetGroup(ctx, groupID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Group not found")
			return
		}
		log.Error("GetGroupRoles failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get group roles")
		return
	}

	if !validateGroupOwnership(w, ctx, group, resolvedOrg.OUID) {
		return
	}

	roles, err := c.client.GetGroupRoles(ctx, groupID)
	if err != nil {
		log.Error("GetGroupRoles failed", "groupID", groupID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get group roles")
		return
	}
	for i := range roles {
		roles[i].IsReadOnly = constants.IsPredefinedRole(roles[i].Name)
	}
	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"roles": roles})
}

// --- Roles ---

func (c *identityController) ListRoles(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	offset := getIntQueryParam(r, "offset", 0)
	limit := getIntQueryParam(r, "limit", 20)
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	roles, _, err := c.client.ListRoles(ctx, resolvedOrg.OUID, offset, limit)
	if err != nil {
		log.Error("ListRoles failed", "ouID", resolvedOrg.OUID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to list roles")
		return
	}

	// Filter roles to only include those belonging to the caller's OU
	// Thunder's ListRoles endpoint returns all roles, not OU-scoped
	// Also exclude the "Administrator" role from public visibility
	filteredRoles := make([]thundersvc.ThunderRole, 0, len(roles))
	for _, role := range roles {
		if role.OuID == resolvedOrg.OUID && role.Name != "Administrator" {
			role.IsReadOnly = constants.IsPredefinedRole(role.Name)
			filteredRoles = append(filteredRoles, role)
		}
	}

	utils.WriteSuccessResponse(w, http.StatusOK, map[string]any{"roles": filteredRoles, "total": len(filteredRoles), "offset": 0, "limit": limit})
}

func (c *identityController) GetRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

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

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	role.IsReadOnly = constants.IsPredefinedRole(role.Name)
	utils.WriteSuccessResponse(w, http.StatusOK, role)
}

func (c *identityController) CreateRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
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
	req.OuID = resolvedOrg.OUID

	role, err := c.client.CreateRole(ctx, req)
	if err != nil {
		log.Error("CreateRole failed", "name", req.Name, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to create role")
		return
	}
	role.IsReadOnly = constants.IsPredefinedRole(role.Name)
	utils.WriteSuccessResponse(w, http.StatusCreated, role)
}

func (c *identityController) UpdateRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("UpdateRole failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update role")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	if !validatePredefinedRole(w, role.Name) {
		return
	}

	var req thundersvc.UpdateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	updatedRole, err := c.client.UpdateRole(ctx, roleID, req)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("UpdateRole failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to update role")
		return
	}
	updatedRole.IsReadOnly = constants.IsPredefinedRole(updatedRole.Name)
	utils.WriteSuccessResponse(w, http.StatusOK, updatedRole)
}

func (c *identityController) DeleteRole(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	log := logger.GetLogger(ctx)
	roleID := r.PathValue(utils.PathParamRoleID)

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("DeleteRole failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to delete role")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	if !validatePredefinedRole(w, role.Name) {
		return
	}

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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("GetRoleAssignments failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to get role assignments")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	assignments, err := c.client.GetRoleAssignments(ctx, roleID)
	if err != nil {
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("AddRolePermissions failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to add role permissions")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	var req thundersvc.RolePermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.AddRolePermissions(ctx, roleID, req); err != nil {
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("RemoveRolePermissions failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to remove role permissions")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	var req thundersvc.RolePermissionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.RemoveRolePermissions(ctx, roleID, req); err != nil {
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("AddRoleAssignees failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to add role assignees")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	req, err := decodeRoleAssigneeRequest(r)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.AddRoleAssignees(ctx, roleID, req); err != nil {
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

	resolvedOrg, ok := middleware.GetResolvedOrg(ctx)
	if !ok {
		utils.WriteErrorResponse(w, http.StatusForbidden, "missing org context")
		return
	}

	role, err := c.client.GetRole(ctx, roleID)
	if err != nil {
		if thundersvc.IsNotFound(err) {
			utils.WriteErrorResponse(w, http.StatusNotFound, "Role not found")
			return
		}
		log.Error("RemoveRoleAssignees failed", "roleID", roleID, "error", err)
		utils.WriteErrorResponse(w, http.StatusInternalServerError, "Failed to remove role assignees")
		return
	}

	if !validateRoleOwnership(w, ctx, role, resolvedOrg.OUID) {
		return
	}

	req, err := decodeRoleAssigneeRequest(r)
	if err != nil {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Invalid request body")
		return
	}

	if err := c.client.RemoveRoleAssignees(ctx, roleID, req); err != nil {
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

// validateUserOwnership checks if a user belongs to the caller's OU
func validateUserOwnership(w http.ResponseWriter, ctx context.Context, user *thundersvc.ThunderUser, callerOuID string) bool {
	if user.OuID != "" && user.OuID != callerOuID {
		utils.WriteErrorResponse(w, http.StatusForbidden, "User does not belong to your organization")
		return false
	}
	return true
}

// validateGroupOwnership checks if a group belongs to the caller's OU
func validateGroupOwnership(w http.ResponseWriter, ctx context.Context, group *thundersvc.ThunderGroup, callerOuID string) bool {
	if group.OuID != "" && group.OuID != callerOuID {
		utils.WriteErrorResponse(w, http.StatusForbidden, "Group does not belong to your organization")
		return false
	}
	return true
}

// validateRoleOwnership checks if a role belongs to the caller's OU
func validateRoleOwnership(w http.ResponseWriter, ctx context.Context, role *thundersvc.ThunderRole, callerOuID string) bool {
	if role.OuID != "" && role.OuID != callerOuID {
		utils.WriteErrorResponse(w, http.StatusForbidden, "Role does not belong to your organization")
		return false
	}
	return true
}

func isPredefinedRole(roleName string) bool {
	return constants.IsPredefinedRole(roleName)
}

func validatePredefinedRole(w http.ResponseWriter, roleName string) bool {
	if isPredefinedRole(roleName) {
		utils.WriteErrorResponse(w, http.StatusBadRequest, "Predefined roles cannot be edited or deleted")
		return false
	}
	return true
}
