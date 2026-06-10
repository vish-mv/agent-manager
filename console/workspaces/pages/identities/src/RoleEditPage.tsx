/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  createFilterOptions,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  ListingTable,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";

import { Trash } from "@wso2/oxygen-ui-icons-react";
import { generatePath, useNavigate, useParams } from "react-router-dom";
import {
  useAllUsers,
  useAllGroups,
  useGetRole,
  useGetRoleAssignments,
  useAddRoleAssignees,
  useRemoveRoleAssignees,
  useAddRolePermissions,
  useRemoveRolePermissions,
  useListAMPPermissions,
} from "@agent-management-platform/api-client";
import { PageLayout } from "@agent-management-platform/views";
import {
  absoluteRouteMap,
  type ThunderUser,
  type ThunderGroup,
  type ThunderPermission,
} from "@agent-management-platform/types";

type ActiveTab = "permissions" | "users" | "groups";

const permLabel = (p: ThunderPermission) => p.actionName || p.name.split(":")[1] || p.name;
const permGroup = (p: ThunderPermission) => p.resourceName || p.name.split(":")[0];

type PermissionGroup = { resource: string; permissions: ThunderPermission[] };

const groupPermissions = (perms: ThunderPermission[]): PermissionGroup[] => {
  const map = new Map<string, ThunderPermission[]>();
  for (const p of perms) {
    const g = permGroup(p);
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(p);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([resource, permissions]) => ({ resource, permissions }));
};

const filterPermissions = createFilterOptions<ThunderPermission>({
  stringify: (option) => {
    const resource = permGroup(option);
    const action = permLabel(option);
    return `${resource} ${action}`;
  },
});

export const RoleEditPage: React.FC = () => {
  const { orgId, roleId } = useParams<{ orgId: string; roleId: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<ActiveTab>("permissions");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>();
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: roleData, isLoading: isLoadingRole } = useGetRole({
    orgName: orgId,
    roleId: roleId ?? "",
  });
  const isPermissionsReadOnly = roleData?.isReadOnly ?? false;
  const { data: assignmentsData, isLoading: isLoadingAssignments } = useGetRoleAssignments({
    orgName: orgId,
    roleId: roleId ?? "",
  });
  const { data: allUsersData, isLoading: isLoadingUsers } = useAllUsers({ orgName: orgId });
  const { data: allGroupsData, isLoading: isLoadingGroups } = useAllGroups({ orgName: orgId });
  const { data: catalogData, isLoading: isLoadingCatalog } = useListAMPPermissions({
    orgName: orgId,
  });

  const { mutateAsync: addAssignees } = useAddRoleAssignees();
  const { mutateAsync: removeAssignees } = useRemoveRoleAssignees();
  const { mutateAsync: addPermissions } = useAddRolePermissions();
  const { mutateAsync: removePermissions } = useRemoveRolePermissions();

  // --- Derived server state ---
  const initialUsers: ThunderUser[] = useMemo(
    () => assignmentsData?.users ?? [],
    [assignmentsData],
  );
  const initialGroups: ThunderGroup[] = useMemo(
    () => assignmentsData?.groups ?? [],
    [assignmentsData],
  );
  const initialPermissions: string[] = useMemo(
    () => roleData?.permissions?.flatMap((rp) => rp.permissions) ?? [],
    [roleData],
  );

  const allUsers: ThunderUser[] = useMemo(() => allUsersData?.users ?? [], [allUsersData]);
  const allGroups: ThunderGroup[] = useMemo(() => allGroupsData?.groups ?? [], [allGroupsData]);

  const catalogPermissions: ThunderPermission[] = useMemo(
    () => catalogData?.permissions ?? [],
    [catalogData],
  );
  const resourceServerId: string = catalogData?.resourceServerId ?? "";

  // --- User tab delta tracking ---
  const [pendingUserAdds, setPendingUserAdds] = useState<ThunderUser[]>([]);
  const [removedUserIds, setRemovedUserIds] = useState<Set<string>>(new Set());

  // --- Group tab delta tracking ---
  const [pendingGroupAdds, setPendingGroupAdds] = useState<ThunderGroup[]>([]);
  const [removedGroupIds, setRemovedGroupIds] = useState<Set<string>>(new Set());

  // --- Permissions tab: full selected-state approach ---
  const [selectedPermissions, setSelectedPermissions] = useState<ThunderPermission[]>([]);
  const hasEditedPermissions = useRef(false);

  // Initialise selectedPermissions from server data once (guard against refetch overwrites)
  useEffect(() => {
    if (!hasEditedPermissions.current && catalogPermissions.length > 0) {
      const nameSet = new Set(initialPermissions);
      setSelectedPermissions(catalogPermissions.filter((p) => nameSet.has(p.name)));
    }
  }, [initialPermissions, catalogPermissions]);

  const rolesPath = orgId
    ? generatePath(
        (absoluteRouteMap.children.org.children as unknown as {
          identities: { children: { roles: { path: string } } };
        }).identities.children.roles.path,
        { orgId },
      )
    : "#";

  // --- Derived displayed lists (users / groups) ---
  const displayedUsers = useMemo(() => {
    const base = initialUsers.filter((u) => !removedUserIds.has(u.id));
    return [...base, ...pendingUserAdds];
  }, [initialUsers, pendingUserAdds, removedUserIds]);

  const displayedGroups = useMemo(() => {
    const base = initialGroups.filter((g) => !removedGroupIds.has(g.id));
    return [...base, ...pendingGroupAdds];
  }, [initialGroups, pendingGroupAdds, removedGroupIds]);

  const displayedUserIds = useMemo(
    () => new Set(displayedUsers.map((u) => u.id)),
    [displayedUsers],
  );
  const displayedGroupIds = useMemo(
    () => new Set(displayedGroups.map((g) => g.id)),
    [displayedGroups],
  );

  const availableUsers = useMemo(
    () => allUsers.filter((u) => !displayedUserIds.has(u.id)),
    [allUsers, displayedUserIds],
  );
  const availableGroups = useMemo(
    () => allGroups.filter((g) => !displayedGroupIds.has(g.id)),
    [allGroups, displayedGroupIds],
  );

  const catalogGroups = useMemo(() => groupPermissions(catalogPermissions), [catalogPermissions]);

  const selectedNames = useMemo(
    () => new Set(selectedPermissions.map((p) => p.name)),
    [selectedPermissions],
  );

  const getUsername = (user: ThunderUser) =>
    String(user.attributes?.["username"] ?? user.id ?? "");

  // --- User handlers ---
  const handleAddUser = (_e: React.SyntheticEvent, value: ThunderUser | null) => {
    if (!value) return;
    if (removedUserIds.has(value.id)) {
      setRemovedUserIds((prev) => { const n = new Set(prev); n.delete(value.id); return n; });
    } else {
      setPendingUserAdds((prev) => [...prev, value]);
    }
  };

  const handleRemoveUser = (userId: string) => {
    if (pendingUserAdds.find((u) => u.id === userId)) {
      setPendingUserAdds((prev) => prev.filter((u) => u.id !== userId));
    } else {
      setRemovedUserIds((prev) => new Set([...prev, userId]));
    }
  };

  // --- Group handlers ---
  const handleAddGroup = (_e: React.SyntheticEvent, value: ThunderGroup | null) => {
    if (!value) return;
    if (removedGroupIds.has(value.id)) {
      setRemovedGroupIds((prev) => { const n = new Set(prev); n.delete(value.id); return n; });
    } else {
      setPendingGroupAdds((prev) => [...prev, value]);
    }
  };

  const handleRemoveGroup = (groupId: string) => {
    if (pendingGroupAdds.find((g) => g.id === groupId)) {
      setPendingGroupAdds((prev) => prev.filter((g) => g.id !== groupId));
    } else {
      setRemovedGroupIds((prev) => new Set([...prev, groupId]));
    }
  };

  // --- Permissions handler ---
  const handlePermissionsChange = (
    _e: React.SyntheticEvent,
    newValue: ThunderPermission[],
  ) => {
    hasEditedPermissions.current = true;
    setSelectedPermissions(newValue);
  };

  const handleRemovePermission = (name: string) => {
    hasEditedPermissions.current = true;
    setSelectedPermissions((prev) => prev.filter((p) => p.name !== name));
  };

  // --- Save ---
  const handleSave = async () => {
    if (!orgId || !roleId) return;
    setSaveError(undefined);
    setSaveSuccess(false);
    setIsSaving(true);
    try {
      const params = { orgName: orgId, roleId };

      // Users
      const addUserIds = pendingUserAdds.map((u) => u.id);
      const removeUserIds = [...removedUserIds];
      if (addUserIds.length > 0) {
        await addAssignees({ params, body: { userIds: addUserIds } });
      }
      if (removeUserIds.length > 0) {
        await removeAssignees({ params, body: { userIds: removeUserIds } });
      }

      // Groups
      const addGroupIds = pendingGroupAdds.map((g) => g.id);
      const removeGroupIds = [...removedGroupIds];
      if (addGroupIds.length > 0) {
        await addAssignees({ params, body: { groupIds: addGroupIds } });
      }
      if (removeGroupIds.length > 0) {
        await removeAssignees({ params, body: { groupIds: removeGroupIds } });
      }

      // Permissions — diff selected vs initial (skip for predefined roles)
      if (hasEditedPermissions.current && resourceServerId && !isPermissionsReadOnly) {
        const currentSet = new Set(initialPermissions);
        const nextSet = new Set(selectedPermissions.map((p) => p.name));
        const toAdd = [...nextSet].filter((n) => !currentSet.has(n));
        const toRemove = [...currentSet].filter((n) => !nextSet.has(n));
        if (toAdd.length > 0) {
          await addPermissions({
            params,
            body: { resourceServerId, permissions: toAdd },
          });
        }
        if (toRemove.length > 0) {
          await removePermissions({
            params,
            body: { resourceServerId, permissions: toRemove },
          });
        }
      }

      setSaveSuccess(true);
      setPendingUserAdds([]);
      setRemovedUserIds(new Set());
      setPendingGroupAdds([]);
      setRemovedGroupIds(new Set());
      hasEditedPermissions.current = false;
    } catch {
      setSaveError("Failed to update role. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const isLoading =
    isLoadingRole || isLoadingAssignments || isLoadingUsers || isLoadingGroups || isLoadingCatalog;

  const pageTitle = roleData?.name ? `Edit Role: ${roleData.name}` : "Edit Role";

  if (isLoading) {
    return (
      <PageLayout title="Edit Role" disableIcon>
        <Box display="flex" justifyContent="center" mt={4}>
          <CircularProgress />
        </Box>
      </PageLayout>
    );
  }

  return (
    <PageLayout title={pageTitle} backHref={rolesPath} backLabel="Back to Roles" disableIcon>
      <Stack spacing={3} sx={{ maxWidth: 800 }}>
        {saveError != null && <Alert severity="error">{saveError}</Alert>}
        {saveSuccess && <Alert severity="success">Role updated successfully.</Alert>}

        <Tabs
          value={activeTab}
          onChange={(_e, v) => setActiveTab(v as ActiveTab)}
        >
          <Tab label="Permissions" value="permissions" />
          <Tab label="Users" value="users" />
          <Tab label="Groups" value="groups" />
        </Tabs>

        {/* ── Permissions tab ── */}
        {activeTab === "permissions" && (
          <Box>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>
              Permissions
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              {isPermissionsReadOnly
                ? "Permissions for predefined roles cannot be modified."
                : "Search and select permissions to assign to this role."}
            </Typography>
            <Divider sx={{ mb: 2 }} />

            {!isPermissionsReadOnly && (
              <Autocomplete
                multiple
                disableCloseOnSelect
                options={catalogPermissions}
                value={selectedPermissions}
                onChange={handlePermissionsChange}
                getOptionLabel={(option) => permLabel(option as ThunderPermission)}
                groupBy={(option) => permGroup(option as ThunderPermission)}
                filterOptions={filterPermissions}
                isOptionEqualToValue={(option, value) =>
                  (option as ThunderPermission).name === (value as ThunderPermission).name
                }
                renderTags={() => null}
                renderGroup={(params) => {
                  const groupPerms = catalogPermissions.filter(
                    (p) => permGroup(p) === params.group,
                  );
                  const allSelected = groupPerms.every((p) => selectedNames.has(p.name));
                  const someSelected = groupPerms.some((p) => selectedNames.has(p.name));
                  const handleGroupToggle = (e: React.MouseEvent) => {
                    e.stopPropagation();
                    hasEditedPermissions.current = true;
                    if (allSelected) {
                      setSelectedPermissions((prev) =>
                        prev.filter((p) => permGroup(p) !== params.group),
                      );
                    } else {
                      const toAdd = groupPerms.filter((p) => !selectedNames.has(p.name));
                      setSelectedPermissions((prev) => [...prev, ...toAdd]);
                    }
                  };
                  return (
                    <li key={params.key}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          px: 1,
                          py: 0.25,
                          cursor: "pointer",
                          userSelect: "none",
                          "&:hover": { bgcolor: "action.hover" },
                        }}
                        onClick={handleGroupToggle}
                      >
                        <Checkbox
                          checked={allSelected}
                          indeterminate={someSelected && !allSelected}
                          size="small"
                          sx={{ mr: 0.5, p: 0.5 }}
                          onClick={(e) => e.stopPropagation()}
                          onChange={
                            handleGroupToggle as unknown as React.ChangeEventHandler<
                              HTMLInputElement
                            >
                          }
                        />
                        <Typography
                          variant="caption"
                          fontWeight={700}
                          sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
                        >
                          {params.group}
                        </Typography>
                      </Box>
                      <ul style={{ padding: 0 }}>{params.children}</ul>
                    </li>
                  );
                }}
                renderOption={(props, option, { selected }) => (
                  <li {...props}>
                    <Checkbox checked={selected} size="small" sx={{ mr: 1 }} />
                    {permLabel(option as ThunderPermission)}
                  </li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Add permissions"
                    placeholder="Search by resource or action..."
                  />
                )}
                noOptionsText="No permissions available"
                sx={{ mb: 3 }}
              />
            )}

            {selectedPermissions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No permissions assigned yet.
              </Typography>
            ) : (
              <Stack spacing={2}>
                {catalogGroups
                  .filter(({ permissions }) =>
                    permissions.some((p) => selectedNames.has(p.name)),
                  )
                  .map(({ resource, permissions }) => (
                    <Box key={resource}>
                      <Typography
                        variant="caption"
                        fontWeight={600}
                        color="text.secondary"
                        sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
                      >
                        {resource}
                      </Typography>
                      <Stack direction="row" flexWrap="wrap" gap={1} mt={0.5}>
                        {permissions
                          .filter((p) => selectedNames.has(p.name))
                          .map((p) => (
                            <Chip
                              key={p.name}
                              label={permLabel(p)}
                              size="small"
                              onDelete={
                                !isPermissionsReadOnly
                                  ? () => handleRemovePermission(p.name)
                                  : undefined
                              }
                            />
                          ))}
                      </Stack>
                    </Box>
                  ))}
              </Stack>
            )}
          </Box>
        )}

        {/* ── Users tab ── */}
        {activeTab === "users" && (
          <Box>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>
              Assigned Users
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Search and add users to this role.
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <Autocomplete
              options={availableUsers}
              getOptionLabel={(option) => getUsername(option as ThunderUser)}
              onChange={handleAddUser}
              value={null}
              renderInput={(params) => (
                <TextField {...params} placeholder="Search users..." label="Add User" />
              )}
              noOptionsText="No users available"
              sx={{ mb: 2 }}
            />

            {displayedUsers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No users assigned yet. Search and add users above.
              </Typography>
            ) : (
              <ListingTable.Container>
                <ListingTable>
                  <ListingTable.Head>
                    <ListingTable.Row>
                      <ListingTable.Cell>Username</ListingTable.Cell>
                      <ListingTable.Cell>User ID</ListingTable.Cell>
                      <ListingTable.Cell />
                    </ListingTable.Row>
                  </ListingTable.Head>
                  <ListingTable.Body>
                    {displayedUsers.map((user) => (
                      <ListingTable.Row key={user.id}>
                        <ListingTable.Cell>{getUsername(user)}</ListingTable.Cell>
                        <ListingTable.Cell>{user.id}</ListingTable.Cell>
                        <ListingTable.Cell align="right">
                          <Tooltip title="Remove from role">
                            <IconButton
                              size="small"
                              onClick={() => handleRemoveUser(user.id)}
                            >
                              <Trash size={16} />
                            </IconButton>
                          </Tooltip>
                        </ListingTable.Cell>
                      </ListingTable.Row>
                    ))}
                  </ListingTable.Body>
                </ListingTable>
              </ListingTable.Container>
            )}
          </Box>
        )}

        {/* ── Groups tab ── */}
        {activeTab === "groups" && (
          <Box>
            <Typography variant="subtitle1" fontWeight={600} mb={1}>
              Assigned Groups
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={2}>
              Search and add groups to this role.
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <Autocomplete
              options={availableGroups}
              getOptionLabel={(option) => (option as ThunderGroup).name}
              onChange={handleAddGroup}
              value={null}
              renderInput={(params) => (
                <TextField {...params} placeholder="Search groups..." label="Add Group" />
              )}
              noOptionsText="No groups available"
              sx={{ mb: 2 }}
            />

            {displayedGroups.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No groups assigned yet. Search and add groups above.
              </Typography>
            ) : (
              <ListingTable.Container>
                <ListingTable>
                  <ListingTable.Head>
                    <ListingTable.Row>
                      <ListingTable.Cell>Name</ListingTable.Cell>
                      <ListingTable.Cell>Description</ListingTable.Cell>
                      <ListingTable.Cell />
                    </ListingTable.Row>
                  </ListingTable.Head>
                  <ListingTable.Body>
                    {displayedGroups.map((group) => (
                      <ListingTable.Row key={group.id}>
                        <ListingTable.Cell>{group.name}</ListingTable.Cell>
                        <ListingTable.Cell>{group.description ?? "-"}</ListingTable.Cell>
                        <ListingTable.Cell align="right">
                          <Tooltip title="Remove from role">
                            <IconButton
                              size="small"
                              onClick={() => handleRemoveGroup(group.id)}
                            >
                              <Trash size={16} />
                            </IconButton>
                          </Tooltip>
                        </ListingTable.Cell>
                      </ListingTable.Row>
                    ))}
                  </ListingTable.Body>
                </ListingTable>
              </ListingTable.Container>
            )}
          </Box>
        )}

        {!(isPermissionsReadOnly && activeTab === "permissions") && (
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={() => navigate(rolesPath)} disabled={isSaving}>
              Cancel
            </Button>
            <Button variant="contained" onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          </Stack>
        )}
      </Stack>
    </PageLayout>
  );
};
