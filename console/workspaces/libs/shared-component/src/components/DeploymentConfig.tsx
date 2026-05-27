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

import {
  useDeployAgent,
  useGetAgent,
  useGetAgentConfigurations,
  useListEnvironments,
} from "@agent-management-platform/api-client";
import { ChevronDown, Rocket } from "@wso2/oxygen-ui-icons-react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Form,
  FormControl,
  FormControlLabel,
  FormLabel,
  Skeleton,
  Switch,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { EnvironmentVariable } from "./EnvironmentVariable";
import { FileMountSection } from "./FileMountSection";
import type {
  AgentKindConfigSchemaItem,
  Environment,
  EnvironmentVariable as EnvVar,
  FileMount,
} from "@agent-management-platform/types";
import { useEffect, useMemo, useState } from "react";
import {
  TextInput,
  DrawerHeader,
  DrawerContent,
} from "@agent-management-platform/views";

interface DeploymentConfigProps {
  onClose: () => void;
  from?: string;
  to: string;
  orgName: string;
  projName: string;
  agentName: string;
  imageId: string;
  /** When provided (kind agents), seeds env vars from schema and locks those keys */
  configSchema?: AgentKindConfigSchemaItem[];
}

export function DeploymentConfig({
  onClose,
  from,
  to,
  orgName,
  projName,
  agentName,
  imageId,
  configSchema,
}: DeploymentConfigProps) {
  const [envVariables, setEnvVariables] = useState<
    Array<{
      key: string;
      value: string;
      isSensitive?: boolean;
      secretRef?: string;
      isSecretEdited?: boolean;
    }>
  >([]);
  const [fileMounts, setFileMounts] = useState<
    Array<{
      key: string;
      mountPath: string;
      value: string;
      isSensitive?: boolean;
      secretRef?: string;
      isSecretEdited?: boolean;
    }>
  >([]);
  const [enableAutoInstrumentation, setEnableAutoInstrumentation] =
    useState<boolean>(true);
  const [enableApiKeySecurity, setEnableApiKeySecurity] =
    useState<boolean>(true);
  const [corsEnabled, setCorsEnabled] = useState<boolean>(true);
  const [corsAllowAll, setCorsAllowAll] = useState<boolean>(true);
  const [corsOrigins, setCorsOrigins] = useState<string[]>(["*"]);
  const [corsMethods, setCorsMethods] = useState<string[]>(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]);
  const [corsHeaders, setCorsHeaders] = useState<string[]>(["authorization", "Content-Type", "Origin", "X-API-Key"]);
  const [corsAllowCredentials, setCorsAllowCredentials] = useState<boolean>(false);

  const { mutate: deployAgent, isPending } = useDeployAgent();
  const { data: agent, isLoading: isLoadingAgent } = useGetAgent({
    orgName,
    projName,
    agentName,
  });
  const { data: environments, isLoading: isLoadingEnvironments } =
    useListEnvironments({
      orgName,
    });
  const { data: configurations, isLoading: isLoadingConfigurations } =
    useGetAgentConfigurations(
      {
        orgName,
        projName,
        agentName,
      },
      {
        environment: to || "",
      },
    );

  useEffect(() => {
    const envs = configurations?.configurations?.env;
    setEnvVariables(
      envs ? [...envs].sort((a, b) => a.key.localeCompare(b.key)) : [],
    );
    const files = configurations?.configurations?.files;
    setFileMounts(
      files
        ? files.map((f) => ({
            key: f.key,
            mountPath: f.mountPath,
            value: f.value ?? "",
            isSensitive: f.isSensitive,
            secretRef: f.secretRef,
          }))
        : [],
    );
  }, [configurations]);
  useEffect(() => {
    const configs = configurations?.configurations?.env;
    if (configSchema && configSchema.length > 0) {
      // Build a lookup of existing deployed config values keyed by var name
      const existingByKey = new Map((configs ?? []).map((c) => [c.key, c]));
      // Schema-defined vars come first (locked), merged with existing values
      const schemaVars = configSchema.map((item) => {
        const existing = existingByKey.get(item.name);
        if (existing) {
          return existing;
        }
        return {
          key: item.name,
          value: item.defaultValue ?? "",
          isSensitive: item.isSecret,
        };
      });
      // Append any extra deployed vars that aren't part of the schema
      const schemaKeys = new Set(configSchema.map((i) => i.name));
      const extraVars = (configs ?? [])
        .filter((c) => !schemaKeys.has(c.key))
        .sort((a, b) => a.key.localeCompare(b.key));
      setEnvVariables([...schemaVars, ...extraVars]);
    } else {
      setEnvVariables(
        configs ? [...configs].sort((a, b) => a.key.localeCompare(b.key)) : [],
      );
    }
  }, [configurations, configSchema]);

  useEffect(() => {
    if (agent?.configurations?.enableAutoInstrumentation !== undefined) {
      setEnableAutoInstrumentation(
        agent.configurations.enableAutoInstrumentation,
      );
    }
  }, [agent?.configurations?.enableAutoInstrumentation]);

  useEffect(() => {
    if (agent?.configurations?.enableApiKeySecurity !== undefined) {
      setEnableApiKeySecurity(agent.configurations.enableApiKeySecurity);
    }
  }, [agent?.configurations?.enableApiKeySecurity]);

  useEffect(() => {
    const cors = agent?.configurations?.corsConfig;
    if (cors) {
      if (cors.enabled !== undefined) setCorsEnabled(cors.enabled);
      if (cors.allowOrigin !== undefined) {
        const isWildcard = cors.allowOrigin.length === 1 && cors.allowOrigin[0] === "*";
        setCorsAllowAll(isWildcard);
        setCorsOrigins(cors.allowOrigin);
      }
      if (cors.allowMethods !== undefined) setCorsMethods(cors.allowMethods);
      if (cors.allowHeaders !== undefined) setCorsHeaders(cors.allowHeaders);
      if (cors.allowCredentials !== undefined) setCorsAllowCredentials(cors.allowCredentials);
    }
  }, [agent?.configurations?.corsConfig]);

  const isPythonBuildpack =
    agent?.build?.type === "buildpack" &&
    "buildpack" in agent.build &&
    agent.build.buildpack.language === "python";

  const isApiAgent = agent?.agentType?.type === "agent-api";

  const hasWildcardOrigin = corsAllowAll || corsOrigins.includes("*");

  const lockedKeys = useMemo(
    () => new Set((configSchema ?? []).map((i) => i.name)),
    [configSchema],
  );

  const handleDeploy = async () => {
    try {
      // Build env payload based on:
      // 1. Deleted items are not in envVariables array (already filtered out)
      // 2. If secret has secretRef and NOT edited: value = empty,
      //    secretRef = original ref (preserve)
      // 3. If secret is new (no secretRef) OR edited: value = new value, no secretRef
      const filteredEnvVars: EnvVar[] = envVariables
        .filter((envVar) => {
          // Include if it has a key and either:
          // - Has a value (plain env var or new/updated secret)
          // - Is an existing secret that wasn't edited (has secretRef)
          if (!envVar.key) return false;
          if (envVar.value) return true;
          if (
            envVar.isSensitive &&
            envVar.secretRef &&
            !envVar.isSecretEdited
          ) {
            return true;
          }
          return false;
        })
        .map((envVar) => {
          if (envVar.isSensitive) {
            // Check if this is an existing secret that should be preserved
            const isExistingSecretPreserved =
              envVar.secretRef && !envVar.isSecretEdited;

            if (isExistingSecretPreserved) {
              // Existing secret NOT changed - send empty value, keep secretRef
              return {
                key: envVar.key,
                value: "",
                isSensitive: true,
                secretRef: envVar.secretRef,
              };
            } else {
              // New secret OR existing secret with new value - send the value
              return {
                key: envVar.key,
                value: envVar.value,
                isSensitive: true,
                // secretRef is intentionally omitted for new/updated secrets
              };
            }
          }
          // Plain env var
          return {
            key: envVar.key,
            value: envVar.value,
            isSensitive: false,
          };
        });

      // Build file mounts payload
      const filteredFiles: FileMount[] = fileMounts
        .filter((f) => f.key && f.mountPath)
        .map((f) => {
          if (f.isSensitive) {
            const isExistingPreserved = f.secretRef && !f.isSecretEdited;
            if (isExistingPreserved) {
              return {
                key: f.key,
                mountPath: f.mountPath,
                value: "",
                isSensitive: true,
                secretRef: f.secretRef,
              };
            }
            return {
              key: f.key,
              mountPath: f.mountPath,
              value: f.value,
              isSensitive: true,
            };
          }
          return {
            key: f.key,
            mountPath: f.mountPath,
            value: f.value,
            isSensitive: false,
          };
        });

      deployAgent(
        {
          params: {
            orgName,
            projName,
            agentName,
          },
          body: {
            imageId: imageId,
            env: filteredEnvVars.length > 0 ? filteredEnvVars : undefined,
            files: filteredFiles.length > 0 ? filteredFiles : undefined,
            ...(isPythonBuildpack && { enableAutoInstrumentation }),
            ...(isApiAgent && { enableApiKeySecurity }),
            ...(isApiAgent && {
              corsConfig: {
                enabled: corsEnabled,
                allowOrigin: hasWildcardOrigin ? ["*"] : corsOrigins,
                allowMethods: corsMethods,
                allowHeaders: corsHeaders,
                allowCredentials: hasWildcardOrigin ? false : corsAllowCredentials,
              },
            }),
          },
        },
        {
          onSuccess: () => {
            onClose();
          },
        },
      );
    } catch {
      // Error handling is done by the mutation
    }
  };

  const toEnvironment = environments?.find(
    (environment: Environment) => environment.name === to,
  );

  const deployButtonText = from
    ? `Promote to ${toEnvironment?.displayName ?? to}`
    : `Deploy to ${toEnvironment?.displayName ?? to}`;
  const titleText = from
    ? `Promote to ${toEnvironment?.displayName ?? to}`
    : `Deploy to ${toEnvironment?.displayName ?? to}`;
  const descriptionText = from
    ? `Promote ${agent?.displayName || "Agent"} to ${toEnvironment?.displayName ?? to} Environment. Configure environment variables and deploy immediately.`
    : `Deploy ${agent?.displayName || "Agent"} to ${toEnvironment?.displayName ?? to} Environment. Configure environment variables and deploy immediately.`;

  return (
    <Box display="flex" flexDirection="column" height="100%">
      <DrawerHeader
        icon={<Rocket size={24} />}
        title={titleText}
        onClose={onClose}
      />
      <DrawerContent>
        <Typography variant="body2" color="text.secondary">
          {descriptionText}
        </Typography>

        <Form.Stack spacing={3}>
          <Form.Section>
            <Form.Header>Deployment Details</Form.Header>
            <Form.Stack spacing={2}>
              <TextInput
                label="Image ID"
                value={imageId}
                size="small"
                disabled
                fullWidth
              />
            </Form.Stack>
          </Form.Section>

          <Form.Section>
            <Form.Header>Environment Variables</Form.Header>
            {isLoadingConfigurations ||
            isLoadingEnvironments ||
            isLoadingAgent ? (
              <Skeleton variant="rectangular" width="100%" height={305} />
            ) : (
              <EnvironmentVariable
                hideTitle
                envVariables={envVariables}
                setEnvVariables={setEnvVariables}
                isExistingData={true}
                lockedKeys={lockedKeys}
              />
            )}
          </Form.Section>

          <Form.Section>
            <Form.Header>File Mounts</Form.Header>
            {isLoadingConfigurations ||
            isLoadingEnvironments ||
            isLoadingAgent ? (
              <Skeleton variant="rectangular" width="100%" height={150} />
            ) : (
              <FileMountSection
                fileMounts={fileMounts}
                setFileMounts={setFileMounts}
              />
            )}
          </Form.Section>

          {isPythonBuildpack && (
            <Form.Section>
              <Form.Header>Instrumentation</Form.Header>
              <Form.Stack spacing={1}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableAutoInstrumentation}
                      onChange={(_, checked) =>
                        setEnableAutoInstrumentation(checked)
                      }
                      disabled={isPending}
                    />
                  }
                  label="Enable auto instrumentation"
                />
                <Typography variant="body2" color="text.secondary">
                  Automatically adds OTEL tracing instrumentation to your agent
                  for observability.
                </Typography>
                {enableAutoInstrumentation &&
                  agent?.configurations?.instrumentationVersion && (
                    <Typography variant="body2" color="text.secondary">
                      AMP instrumentation version:{" "}
                      <Typography
                        component="code"
                        sx={{
                          bgcolor: "action.hover",
                          px: 0.5,
                          borderRadius: 0.5,
                        }}
                      >
                        {agent.configurations.instrumentationVersion}
                      </Typography>{" "}
                      (set at agent creation time)
                    </Typography>
                  )}
              </Form.Stack>
            </Form.Section>
          )}

          {isApiAgent && (
            <Form.Section>
              <Form.Header>CORS Configuration</Form.Header>
              <Form.Stack spacing={1}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={corsEnabled}
                      onChange={(_, checked) => setCorsEnabled(checked)}
                      disabled={isPending}
                    />
                  }
                  label="Enable CORS"
                />
                <Typography variant="body2" color="text.secondary">
                  Control which origins, methods, and headers are allowed to access this agent
                  endpoint.
                </Typography>
                <Collapse in={corsEnabled}>
                  <Accordion
                    disableGutters
                    elevation={0}
                    sx={{ mt: 1, border: "1px solid", borderColor: "divider", borderRadius: 1, "&:before": { display: "none" } }}
                  >
                    <AccordionSummary expandIcon={<ChevronDown size={16} />}>
                      <Typography variant="body2">Advanced</Typography>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Form.Stack spacing={2}>
                        <Box display="flex" gap={2} alignItems="center">
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={corsAllowAll}
                                onChange={(_, checked) => {
                                  setCorsAllowAll(checked);
                                  if (checked) {
                                    setCorsAllowCredentials(false);
                                    setCorsOrigins(["*"]);
                                  } else {
                                    setCorsOrigins((prev) => prev.filter((o) => o !== "*"));
                                  }
                                }}
                                disabled={isPending}
                              />
                            }
                            label="Allow all origins"
                          />
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={corsAllowCredentials}
                                onChange={(_, checked) => setCorsAllowCredentials(checked)}
                                disabled={isPending || hasWildcardOrigin}
                              />
                            }
                            label="Allow credentials"
                          />
                        </Box>
                          {!corsAllowAll && (
                            <FormControl fullWidth>
                              <FormLabel>Allowed origins</FormLabel>
                              <Autocomplete
                                multiple
                                freeSolo
                                options={[]}
                                value={corsOrigins}
                                onChange={(_, newValue) => setCorsOrigins(newValue as string[])}
                                renderTags={(tagValues, getTagProps) =>
                                  tagValues.map((option, index) => (
                                    <Chip
                                      label={option as string}
                                      size="small"
                                      {...getTagProps({ index })}
                                      key={option as string}
                                    />
                                  ))
                                }
                                renderInput={(params) => (
                                  <TextField {...params} size="small" placeholder="Add origin and press Enter" />
                                )}
                              />
                            </FormControl>
                          )}
                          <FormControl fullWidth>
                            <FormLabel>Allowed methods</FormLabel>
                            <Autocomplete
                              multiple
                              freeSolo
                              options={[]}
                              value={corsMethods}
                              onChange={(_, newValue) => setCorsMethods(newValue as string[])}
                              renderTags={(tagValues, getTagProps) =>
                                tagValues.map((option, index) => (
                                  <Chip
                                    label={option as string}
                                    size="small"
                                    {...getTagProps({ index })}
                                    key={option as string}
                                  />
                                ))
                              }
                              renderInput={(params) => (
                                <TextField {...params} size="small" placeholder="Add method and press Enter" />
                              )}
                            />
                          </FormControl>
                          <FormControl fullWidth>
                            <FormLabel>Allowed headers</FormLabel>
                            <Autocomplete
                              multiple
                              freeSolo
                              options={[]}
                              value={corsHeaders}
                              onChange={(_, newValue) => setCorsHeaders(newValue as string[])}
                              renderTags={(tagValues, getTagProps) =>
                                tagValues.map((option, index) => (
                                  <Chip
                                    label={option as string}
                                    size="small"
                                    {...getTagProps({ index })}
                                    key={option as string}
                                  />
                                ))
                              }
                              renderInput={(params) => (
                                <TextField {...params} size="small" placeholder="Add header and press Enter" />
                              )}
                            />
                          </FormControl>
                      </Form.Stack>
                    </AccordionDetails>
                  </Accordion>
                </Collapse>
              </Form.Stack>
            </Form.Section>
          )}

          {isApiAgent && (
            <Form.Section>
              <Form.Header>Endpoint Authentication</Form.Header>
              <Form.Stack spacing={1}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={enableApiKeySecurity}
                      onChange={(_, checked) =>
                        setEnableApiKeySecurity(checked)
                      }
                      disabled={isPending}
                    />
                  }
                  label="Enable API key security"
                />
                <Typography variant="body2" color="text.secondary">
                  Secure your agent endpoint with API key authentication.
                </Typography>
                <Collapse in={enableApiKeySecurity}>
                  <TextInput
                    label="Header"
                    value="X-API-Key"
                    size="small"
                    fullWidth
                    disabled
                    sx={{ mt: 1 }}
                  />
                </Collapse>
              </Form.Stack>
            </Form.Section>
          )}

          <Box display="flex" gap={1} justifyContent="flex-end" width="100%">
            <Button
              variant="outlined"
              color="primary"
              onClick={onClose}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              variant="contained"
              color="primary"
              onClick={handleDeploy}
              startIcon={<Rocket size={16} />}
              disabled={isPending}
            >
              {isPending ? "Deploying..." : deployButtonText}
            </Button>
          </Box>
        </Form.Stack>
      </DrawerContent>
    </Box>
  );
}
