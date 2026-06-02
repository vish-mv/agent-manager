/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PageLayout,
  TextInput,
} from "@agent-management-platform/views";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  Divider,
  Form,
  ListingTable,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import {
  AlertTriangle,
  Check,
  Circle,
  Coins,
  Hash,
  Info,
  Link,
  Search,
  ServerCog,
  Zap,
} from "@wso2/oxygen-ui-icons-react";
import { formatDistanceToNow } from "date-fns";
import { generatePath, useNavigate, useParams } from "react-router-dom";
import {
  absoluteRouteMap,
  type CatalogSecuritySummary,
  type CatalogRateLimitingSummary,
  type LLMPolicy,
} from "@agent-management-platform/types";
import {
  useCreateAgentModelConfig,
  useGetAgent,
  useGetAgentModelConfig,
  useListAgentModelConfigs,
  useListCatalogLLMProviders,
  useListEnvironments,
  useListLLMProviderTemplates,
  useUpdateAgentModelConfig,
} from "@agent-management-platform/api-client";
import {
  GuardrailsSection,
  type GuardrailSelection,
} from "@agent-management-platform/llm-providers";
import { ProviderSelectDrawer } from "./ProviderSelectDrawer";

type DeploymentSummary = { gatewayName?: string; deployedAt?: string };

const ENV_VAR_KEYS = ["url", "apikey"] as const;
type EnvVarKey = (typeof ENV_VAR_KEYS)[number];

const ENV_VAR_DESCRIPTIONS: Record<EnvVarKey, string> = {
  url: "Base URL of the LLM provider",
  apikey: "API key for authenticating with the LLM provider",
};

function generateEnvVarNames(prefix: string): Record<EnvVarKey, string> {
  let sanitized = prefix.replace(/[^A-Za-z0-9_]/g, "_").toUpperCase();
  if (sanitized.length > 0 && sanitized[0] >= "0" && sanitized[0] <= "9") {
    sanitized = "_" + sanitized;
  }
  return {
    url: sanitized ? `${sanitized}_URL` : "URL",
    apikey: sanitized ? `${sanitized}_API_KEY` : "API_KEY",
  };
}

function generateConfigName(templateId: string, existingNames: string[]): string {
  const base = templateId.replace(/[^A-Za-z0-9-]/g, "-").toLowerCase();
  if (!existingNames.includes(base)) return base;
  let i = 2;
  while (existingNames.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function getLatestDeployment(
  deployments: DeploymentSummary[] | undefined,
): DeploymentSummary | null {
  if (!deployments?.length) return null;
  const sorted = [...deployments].sort(
    (a, b) =>
      new Date(b.deployedAt ?? 0).getTime() -
      new Date(a.deployedAt ?? 0).getTime(),
  );
  return sorted[0] ?? null;
}

function formatCost(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(6)}`;
  return `$${amount.toFixed(2)}`;
}

function formatResetWindow(duration?: number, unit?: string): string {
  if (!unit) return "";
  const abbrev: Record<string, string> = { minute: "min", hour: "hr", day: "day" };
  const u = abbrev[unit.toLowerCase()] ?? unit;
  return duration && duration !== 1 ? `${duration} ${u}` : u;
}

const RateLimitDisplay: React.FC<{
  rateLimiting?: CatalogRateLimitingSummary;
}> = ({ rateLimiting }) => {
  if (!rateLimiting) {
    return (
      <Typography variant="caption" color="text.secondary">
        Rate Limiting: <Typography component="span" variant="body2" color="text.disabled">Not configured</Typography>
      </Typography>
    );
  }

  const cl = rateLimiting.consumerLevel;
  const pl = rateLimiting.providerLevel;

  // Whether the consumer level is actively enabled (rate limiting applies to this consumer)
  const consumerEnabled = cl?.globalEnabled ?? false;
  // Whether the consumer level has its own per-consumer numeric limits configured
  const consumerHasLimits =
    consumerEnabled && (cl?.request != null || cl?.token != null || cl?.cost != null);

  if (!consumerEnabled && !pl?.globalEnabled) {
    return (
      <Typography variant="caption" color="text.secondary">
        Rate Limiting: <Typography component="span" variant="body2" color="text.disabled">Configured (disabled)</Typography>
      </Typography>
    );
  }

  // Use consumer-specific limits when set; otherwise fall back to provider limits for display
  const limitScope = consumerHasLimits ? cl : pl;
  // Org-wide whenever we fall back to provider-level limits (no per-consumer numeric overrides)
  const isOrgWide = !consumerHasLimits;

  const limits: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (limitScope?.request) {
    const w = formatResetWindow(limitScope.request.resetDuration, limitScope.request.resetUnit);
    limits.push({ icon: <Zap size={12} />, label: "Requests", value: `${limitScope.request.limit.toLocaleString()}${w ? `/${w}` : ""}` });
  }
  if (limitScope?.token) {
    const w = formatResetWindow(limitScope.token.resetDuration, limitScope.token.resetUnit);
    limits.push({ icon: <Hash size={12} />, label: "Tokens", value: `${limitScope.token.limit.toLocaleString()}${w ? `/${w}` : ""}` });
  }
  if (limitScope?.cost) {
    const w = formatResetWindow(limitScope.cost.resetDuration, limitScope.cost.resetUnit);
    limits.push({ icon: <Coins size={12} />, label: "Budget", value: `${formatCost(limitScope.cost.limit)}${w ? `/${w}` : ""}` });
  }

  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.5} alignItems="center">
        <Typography variant="caption" color="text.secondary">
          {isOrgWide ? "Your Quota (org-wide limit):" : "Your Quota:"}
        </Typography>
        {isOrgWide && (
          <Tooltip
            title="No per-consumer limit is configured. The org-wide provider limit applies to all consumers."
            placement="top"
            arrow
          >
            <Box component="span" sx={{ display: "inline-flex", alignItems: "center", color: "text.secondary", cursor: "default" }}>
              <Info size={12} />
            </Box>
          </Tooltip>
        )}
      </Stack>
      {limits.length > 0 ? (
        <Stack direction="row" spacing={0.75} flexWrap="wrap">
          {limits.map(({ icon, label, value }) => (
            <Chip
              key={label}
              icon={<Box component="span" sx={{ display: "inline-flex", alignItems: "center", pl: 0.5 }}>{icon}</Box>}
              label={`${label}: ${value}`}
              size="small"
              variant="outlined"
              color={isOrgWide ? "default" : "primary"}
              sx={{ fontVariantNumeric: "tabular-nums" }}
            />
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">Enabled (no numeric limits set)</Typography>
      )}
    </Stack>
  );
};

export const ProviderDisplay: React.FC<{
  provider: {
    name: string;
    template?: string;
    version?: string;
    deployments?: DeploymentSummary[];
    security?: CatalogSecuritySummary;
    rateLimiting?: CatalogRateLimitingSummary;
    policies?: string[];
  } | null;
  isSelected: boolean;
  hideCheckbox?: boolean;
  templateInfo?: { displayName: string; logoUrl?: string } | null;
  fallbackLabel?: string;
}> = ({ provider, isSelected, templateInfo, fallbackLabel = "Select provider", hideCheckbox }) => {
  const latest = getLatestDeployment(provider?.deployments);
  return (
    <Stack direction="row" spacing={2} flexGrow={1} alignItems="center">
      {!hideCheckbox && (
        <Avatar
          sx={{
            height: 32,
            width: 32,
            backgroundColor: isSelected ? "primary.main" : "secondary.main",
            color: isSelected ? "common.white" : "text.secondary",
          }}
        >
          {isSelected ? <Check size={16} /> : <Circle size={16} />}
        </Avatar>
      )}
      {hideCheckbox && (
        <Avatar
          src={templateInfo?.logoUrl}
          sx={{ height: 40, width: 40, backgroundColor: "action.selected" }}
        >
          <ServerCog size={20} />
        </Avatar>
      )}

      <Stack spacing={0.25} flexGrow={1}>
        <Stack spacing={0.25}>
          <Stack direction="row" spacing={0.25} alignItems="center">
            <Typography variant="h6">
              {provider?.name ?? fallbackLabel} &nbsp;
            </Typography>
            {provider?.template && (
              <Tooltip title="Service Provider template" placement="top" arrow>
                <Chip
                  label={templateInfo?.displayName ?? provider.template}
                  size="small"
                  variant="outlined"
                  icon={
                    templateInfo?.logoUrl ? (
                      <Box
                        component="img"
                        src={templateInfo.logoUrl}
                        alt={templateInfo.displayName}
                        sx={{ width: 14, height: 14, borderRadius: "100%" }}
                      />
                    ) : undefined
                  }
                />
              </Tooltip>
            )}
          </Stack>
          {latest?.deployedAt && (
            <Typography variant="caption" color="text.secondary">
              Deployed{" "}
              {formatDistanceToNow(new Date(latest.deployedAt), {
                addSuffix: true,
              })}
            </Typography>
          )}
        </Stack>
        <Divider orientation="vertical" />

        <Stack direction="column" spacing={0.5}>
          <RateLimitDisplay rateLimiting={provider?.rateLimiting} />
          <Stack>
            <Typography variant="caption" color="text.secondary">
              Guardrails:{" "}
              <Typography component="span" variant="body2" color={provider?.policies?.length ? "text.primary" : "text.disabled"}>
                {provider?.policies?.length
                  ? (
                    <Stack direction="row" spacing={0.25} flexWrap="wrap" alignItems="center">
                      {provider.policies.slice(0, 3).map((p) => (
                        <Chip key={p} label={p} size="small" variant="outlined" />
                      ))}
                      {
                        provider.policies.length > 3 &&
                        <Tooltip title={provider.policies.join(", ")} placement="top" arrow>
                          <Typography variant="caption" color="text.secondary">
                            {` +${provider.policies.length - 3} more..`}
                          </Typography>
                        </Tooltip>
                      }
                    </Stack>
                  )
                  : "None"}
              </Typography>
            </Typography>
          </Stack>
        </Stack>

      </Stack>
    </Stack>
  );
};

export const AddLLMProviderComponent: React.FC = () => {
  const { orgId, projectId, agentId, configId } = useParams<{
    orgId: string;
    projectId: string;
    agentId: string;
    configId?: string;
  }>();
  const navigate = useNavigate();
  const isEditMode = !!configId;

  const [selectedEnvIndex, setSelectedEnvIndex] = useState(0);
  const [providerByEnv, setProviderByEnv] = useState<
    Record<string, string | null>
  >({});
  const [guardrailsByEnv, setGuardrailsByEnv] = useState<Record<string, GuardrailSelection[]>>({});
  const [envVarNames, setEnvVarNames] = useState<Record<string, string>>(
    () => generateEnvVarNames(""),
  );
  // Track whether the user has manually edited env var names
  const envVarNamesEditedRef = useRef(false);
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false);

  const backHref =
    orgId && projectId && agentId
      ? generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents
          .children.configure.path,
        { orgId, projectId, agentId },
      )
      : "#";

  const { data: agent } = useGetAgent({
    orgName: orgId,
    projName: projectId,
    agentName: agentId,
  });
  const isExternal = agent?.provisioning?.type === "external";

  const { data: environments = [], isLoading: isLoadingEnvironments } = useListEnvironments({
    orgName: orgId,
  });
  const { data: existingConfigsList } = useListAgentModelConfigs({
    orgName: orgId,
    projName: projectId,
    agentName: agentId,
  });
  const selectedEnvironmentId = environments[selectedEnvIndex]?.id;
  const { data: catalogData } = useListCatalogLLMProviders(
    { orgName: orgId },
    { limit: 50, environmentId: selectedEnvironmentId },
  );
  const { data: templatesData } = useListLLMProviderTemplates(
    { orgName: orgId },
  );
  const templateMap = useMemo(() => {
    const map = new Map<string, { displayName: string; logoUrl?: string }>();
    for (const t of templatesData?.templates ?? []) {
      map.set(t.name, { displayName: t.name, logoUrl: t.metadata?.logoUrl });
      map.set(t.id, { displayName: t.name, logoUrl: t.metadata?.logoUrl });
    }
    return map;
  }, [templatesData]);
  const providers = useMemo(
    () =>
      (catalogData?.entries ?? []).map((e) => ({
        uuid: e.uuid,
        id: e.handle,
        name: e.name,
        version: e.version,
        template: e.template,
        deployments: e.deployments ?? [],
        security: e.security,
        rateLimiting: e.rateLimiting,
        policies: e.policies ?? [],
      })),
    [catalogData],
  );

  const {
    data: existingConfig,
    isLoading: isLoadingConfig,
    isError: isConfigError,
  } = useGetAgentModelConfig({
    orgName: orgId,
    projName: projectId,
    agentName: agentId,
    configId: configId ?? undefined,
  });

  useEffect(() => {
    if (!existingConfig || !isEditMode) return;
    const nextProviderByEnv: Record<string, string | null> = {};
    for (const [envName, mapping] of Object.entries(
      existingConfig.envMappings ?? {},
    )) {
      const config = mapping.configuration;
      const providerUuid =
        config?.providerUuid ?? config?.proxyUuid ?? undefined;
      if (providerUuid) {
        nextProviderByEnv[envName] = providerUuid;
      }
    }
    setProviderByEnv(nextProviderByEnv);
    const nextGuardrailsByEnv: Record<string, GuardrailSelection[]> = {};
    for (const [envName, mapping] of Object.entries(existingConfig.envMappings ?? {})) {
      const envPolicies = mapping.configuration?.policies ?? [];
      const seen = new Set<string>();
      const envGuardrails: GuardrailSelection[] = [];
      for (const p of envPolicies) {
        const key = `${p.name}@${p.version}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const params = p.paths?.[0]?.params;
        envGuardrails.push({
          name: p.name,
          version: p.version,
          settings: (params ?? {}) as Record<string, unknown>,
        });
      }
      nextGuardrailsByEnv[envName] = envGuardrails;
    }
    setGuardrailsByEnv(nextGuardrailsByEnv);

    // Populate env var names from the existing config
    if (existingConfig.environmentVariables?.length) {
      const names: Record<string, string> = {};
      for (const ev of existingConfig.environmentVariables) {
        names[ev.key] = ev.name;
      }
      setEnvVarNames(names);
      envVarNamesEditedRef.current = true;
    }
  }, [existingConfig, isEditMode]);

  // Auto-generate env var names from the selected provider's template in create mode
  const primaryTemplate = useMemo(() => {
    const firstEnvName = environments[0]?.name;
    const uuid = firstEnvName ? providerByEnv[firstEnvName] : undefined;
    if (!uuid) return "";
    const provider = providers.find((p) => p.uuid === uuid);
    return provider?.template ?? provider?.id ?? "";
  }, [providerByEnv, providers, environments]);

  useEffect(() => {
    if (isEditMode || envVarNamesEditedRef.current) return;
    setEnvVarNames(generateEnvVarNames(primaryTemplate));
  }, [primaryTemplate, isEditMode]);

  const selectedEnvName = useMemo(
    () => environments[selectedEnvIndex]?.name ?? "",
    [environments, selectedEnvIndex],
  );

  const createConfig = useCreateAgentModelConfig();
  const updateConfig = useUpdateAgentModelConfig();

  const guardrails = useMemo(
    () => guardrailsByEnv[selectedEnvName] ?? [],
    [guardrailsByEnv, selectedEnvName],
  );

  const handleAddGuardrail = useCallback((guardrail: GuardrailSelection) => {
    setGuardrailsByEnv((prev) => {
      const list = prev[selectedEnvName] ?? [];
      const exists = list.some((g) => g.name === guardrail.name && g.version === guardrail.version);
      if (exists) return prev;
      return { ...prev, [selectedEnvName]: [...list, guardrail] };
    });
  }, [selectedEnvName]);

  const handleEditGuardrail = useCallback((guardrail: GuardrailSelection) => {
    setGuardrailsByEnv((prev) => {
      const list = prev[selectedEnvName] ?? [];
      const updated = list.map(
        (g) => g.name === guardrail.name && g.version === guardrail.version ? guardrail : g,
      );
      return { ...prev, [selectedEnvName]: updated };
    });
  }, [selectedEnvName]);

  const handleRemoveGuardrail = useCallback((gName: string, gVersion: string) => {
    setGuardrailsByEnv((prev) => {
      const list = prev[selectedEnvName] ?? [];
      const filtered = list.filter((g) => !(g.name === gName && g.version === gVersion));
      return { ...prev, [selectedEnvName]: filtered };
    });
  }, [selectedEnvName]);

  const handleSave = useCallback(() => {
    const envMappings: Record<
      string,
      {
        providerName?: string;
        configuration: { policies?: LLMPolicy[] };
      }
    > = {};
    let hasAtLeastOneProvider = false;
    let resolvedTemplate = "";

    for (const env of environments) {
      const providerUuid = providerByEnv[env.name] ?? null;
      if (providerUuid) {
        const provider = providers.find((p) => p.uuid === providerUuid);
        if (provider) {
          hasAtLeastOneProvider = true;
          if (!resolvedTemplate) resolvedTemplate = provider.template ?? provider.id ?? "";
          const envGuardrails = guardrailsByEnv[env.name] ?? [];
          const envPolicies = envGuardrails.map((g) => ({
            name: g.name,
            version: g.version,
            paths: [{ path: "/*", methods: ["*"], params: g.settings ?? {} }],
          }));
          envMappings[env.name] = {
            providerName: provider.id,
            configuration: {
              policies: envPolicies.length > 0 ? envPolicies : undefined,
            },
          };
        } else if (isEditMode && existingConfig) {
          // Provider not in current catalog page — preserve existing mapping
          // to avoid dropping providers beyond the catalog page limit.
          const existingMapping = existingConfig.envMappings?.[env.name];
          const existingProviderName = existingMapping?.configuration?.providerName;
          if (existingProviderName) {
            hasAtLeastOneProvider = true;
            const envGuardrails = guardrailsByEnv[env.name] ?? [];
            const envPolicies = envGuardrails.map((g) => ({
              name: g.name,
              version: g.version,
              paths: [{ path: "/*", methods: ["*"], params: g.settings ?? {} }],
            }));
            envMappings[env.name] = {
              providerName: existingProviderName,
              configuration: {
                policies: envPolicies.length > 0 ? envPolicies : undefined,
              },
            };
          }
        }
      }
    }

    if (!hasAtLeastOneProvider) {
      return;
    }

    if (!orgId || !projectId || !agentId) {
      return;
    }

    const environmentVariables = !isExternal
      ? ENV_VAR_KEYS.map((key) => ({
        key,
        name: (envVarNames[key] ?? "").trim(),
      })).filter((ev) => ev.name.length > 0)
      : [];

    // In create mode, auto-generate a name from the provider template
    const existingNames = (existingConfigsList?.configs ?? []).map((c) => c.name);
    const autoName = isEditMode
      ? (existingConfig?.name ?? resolvedTemplate)
      : generateConfigName(resolvedTemplate || "llm", existingNames);

    const body = {
      name: autoName,
      envMappings,
      environmentVariables: environmentVariables.length > 0 ? environmentVariables : undefined,
    };

    if (isEditMode && configId) {
      updateConfig.mutate(
        {
          params: {
            orgName: orgId,
            projName: projectId,
            agentName: agentId,
            configId,
          },
          body,
        },
        {
          onSuccess: () => {
            navigate(backHref);
          },
        },
      );
    } else {
      createConfig.mutate(
        {
          params: {
            orgName: orgId,
            projName: projectId,
            agentName: agentId,
          },
          body: { ...body, type: "llm" as const },
        },
        {
          onSuccess: (data) => {
            // Collect authInfo from all env mappings to pass via router state
            const authInfoByEnv: Record<string,
              { type: string; in: string; name: string; value?: string }> = {};
            for (const [envName, mapping] of Object.entries(data.envMappings ?? {})) {
              if (mapping.configuration?.authInfo) {
                authInfoByEnv[envName] = mapping.configuration.authInfo;
              }
            }
            navigate(
              generatePath(
                absoluteRouteMap.children.org.children.projects.children.agents
                  .children.configure.children.llmProviders.children.view.path,
                { orgId, projectId, agentId, configId: data.uuid },
              ),
              {
                state: { authInfoByEnv },
              },
            );
          },
        },
      );
    }
  }, [
    providerByEnv,
    environments,
    providers,
    guardrailsByEnv,
    envVarNames,
    isExternal,
    orgId,
    projectId,
    agentId,
    configId,
    isEditMode,
    existingConfig,
    existingConfigsList,
    createConfig,
    updateConfig,
    navigate,
    backHref,
  ]);

  const hasAnyProvider = environments.some((env) => {
    const uuid = providerByEnv[env.name];
    if (!uuid) return false;
    if (providers.some((p) => p.uuid === uuid)) return true;
    if (isEditMode && existingConfig) {
      const existing = existingConfig.envMappings?.[env.name];
      return !!existing?.configuration?.providerName;
    }
    return false;
  });

  const allEnvsHaveProvider = environments.length > 0 && environments.every((env) => {
    const uuid = providerByEnv[env.name];
    if (uuid && providers.some((p) => p.uuid === uuid)) return true;
    if (isEditMode && existingConfig) {
      const existing = existingConfig.envMappings?.[env.name];
      return !!existing?.configuration?.providerName;
    }
    return false;
  });
  const isFormValid = hasAnyProvider;

  const mutationError = createConfig.isError
    ? createConfig.error
    : updateConfig.error;
  const isPending = createConfig.isPending || updateConfig.isPending;
  const resetMutation = useCallback(() => {
    createConfig.reset();
    updateConfig.reset();
  }, [createConfig, updateConfig]);

  if (isEditMode && isLoadingConfig) {
    return (
      <PageLayout
        title="Edit LLM Configuration"
        backHref={backHref}
        disableIcon
        backLabel="Back to Configure"
      >
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={120} />
        </Stack>
      </PageLayout>
    );
  }

  if (isEditMode && !isLoadingConfig && (isConfigError || !existingConfig)) {
    return (
      <PageLayout
        title="Edit LLM Configuration"
        backHref={backHref}
        disableIcon
        backLabel="Back to Configure"
      >
        <Alert severity="error" icon={<AlertTriangle size={18} />}>
          Config not found or failed to load.
        </Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title={isEditMode ? "Edit LLM Configuration" : "Add LLM Configuration"}
      backHref={backHref}
      disableIcon
      backLabel="Back to Configure"
    >
      <Stack spacing={3}>
        {mutationError ? (
          <Alert
            severity="error"
            icon={<AlertTriangle size={18} />}
            onClose={resetMutation}
          >
            {String(
              mutationError instanceof Error
                ? mutationError.message
                : isEditMode
                  ? "Failed to update model config. Please try again."
                  : "Failed to create model config. Please try again.",
            )}
          </Alert>
        ) : null}
        <Form.Section>
          <Form.Header>Service Provider</Form.Header>
          {environments.length > 1 && !isLoadingEnvironments && (
            <>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Select which catalog provider to use in each environment.
              </Typography>
              <Tabs
                value={selectedEnvIndex}
                onChange={(_, v: number) => setSelectedEnvIndex(v)}
                sx={{ mb: 2 }}
              >
                {environments.map((env, idx) => {
                  const hasProvider = !!providerByEnv[env.name] || (isEditMode
                    && !!existingConfig?.envMappings?.[env.name]?.configuration?.providerName);
                  return (
                    <Tab
                      key={env.name}
                      label={
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <span>{env.displayName ?? env.name}</span>
                          {!hasProvider && (
                            <Tooltip title="No provider selected" placement="top" arrow>
                              <Box component="span" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "warning.main", display: "inline-block" }} />
                            </Tooltip>
                          )}
                        </Stack>
                      }
                      value={idx}
                    />
                  );
                })}
              </Tabs>
            </>
          )}

          {providerByEnv[selectedEnvName] ? (
            <Form.CardButton
              onClick={() => setProviderDrawerOpen(true)}
              selected
              aria-label={`Selected: ${providers.find((p) => p.uuid === providerByEnv[selectedEnvName])?.name ?? "Unknown"}. Click to change.`}
            >
              <Form.CardContent>
                <ProviderDisplay
                  provider={
                    providers.find(
                      (p) => p.uuid === providerByEnv[selectedEnvName],
                    ) ?? null
                  }
                  isSelected
                  templateInfo={templateMap.get(
                    providers.find((p) => p.uuid === providerByEnv[selectedEnvName])?.template ?? "",
                  )}
                />
              </Form.CardContent>
            </Form.CardButton>
          ) : (
            <Box>
              {catalogData && providers.length === 0 ? (
                <ListingTable.Container>
                  <ListingTable.EmptyState
                    illustration={<Search size={64} />}
                    title="No service providers available"
                    description="No LLM service providers found in the catalog. Add LLM service providers from the organization LLM Service Providers page first."
                    action={
                      orgId ? (
                        <Button
                          variant="contained"
                          size="small"
                          startIcon={<Link size={16} />}
                          onClick={() =>
                            navigate(
                              generatePath(
                                absoluteRouteMap.children.org.children.
                                  llmProviders.children.add.path,
                                { orgId },
                              ),
                            )
                          }
                        >
                          Add LLM Service Provider
                        </Button>
                      ) : undefined
                    }
                  />
                </ListingTable.Container>
              ) : (
                <Box sx={{ pt: 1 }}>
                  <Button
                    variant="outlined"
                    onClick={() => setProviderDrawerOpen(true)}
                    disabled={providers.length === 0 || !selectedEnvName}
                    startIcon={<Link size={16} />}
                  >
                    Select a Service Provider
                  </Button>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                    Selecting a provider will auto-generate environment variable names below.
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          <ProviderSelectDrawer
            open={providerDrawerOpen}
            onClose={() => setProviderDrawerOpen(false)}
            providers={providers}
            templateMap={templateMap}
            selectedUuid={providerByEnv[selectedEnvName] ?? undefined}
            subtitle={
              environments.length > 1
                ? `Choose the catalog provider for the ${environments[selectedEnvIndex]?.displayName ?? environments[selectedEnvIndex]?.name ?? ""} environment.`
                : "Choose the catalog provider for this agent."
            }
            onSelect={(uuid) => {
              if (selectedEnvName) {
                setProviderByEnv((prev) => ({ ...prev, [selectedEnvName]: uuid }));
              }
            }}
          />
          {providerByEnv[selectedEnvName] && (
            <GuardrailsSection
              guardrails={guardrails}
              onAddGuardrail={handleAddGuardrail}
              onEditGuardrail={handleEditGuardrail}
              onRemoveGuardrail={handleRemoveGuardrail}
            />
          )}
        </Form.Section>

        {hasAnyProvider && !isExternal && (
          <Form.Section>
            <Form.Header>Environment Variable Names</Form.Header>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              These names are shared across all environments. The platform injects the actual URL
              and API key values at runtime per environment. Edit only if your code uses different
              names.
            </Typography>
            <ListingTable.Container>
              <ListingTable density="compact">
                <ListingTable.Head>
                  <ListingTable.Row>
                    <ListingTable.Cell>Variable Name <Typography component="span" variant="caption" color="text.secondary">(editable)</Typography></ListingTable.Cell>
                    <ListingTable.Cell>Description</ListingTable.Cell>
                  </ListingTable.Row>
                </ListingTable.Head>
                <ListingTable.Body>
                  {ENV_VAR_KEYS.map((key) => (
                    <ListingTable.Row key={key}>
                      <ListingTable.Cell>
                        <TextInput
                          value={envVarNames[key] ?? ""}
                          onChange={(e) => {
                            envVarNamesEditedRef.current = true;
                            setEnvVarNames((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }));
                          }}
                          copyable
                          copyTooltipText={`Copy ${envVarNames[key] ?? key}`}
                          size="small"
                        />
                      </ListingTable.Cell>
                      <ListingTable.Cell>
                        <Typography variant="body2" color="text.secondary">
                          {ENV_VAR_DESCRIPTIONS[key]}
                        </Typography>
                      </ListingTable.Cell>
                    </ListingTable.Row>
                  ))}
                </ListingTable.Body>
              </ListingTable>
            </ListingTable.Container>
          </Form.Section>
        )}

        {hasAnyProvider && !allEnvsHaveProvider && (
          <Alert severity="info" icon={<AlertTriangle size={18} />}>
            Some environments don&apos;t have a provider selected. They will be skipped on save.
          </Alert>
        )}

        {/* Actions */}
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button variant="outlined" onClick={() => navigate(backHref)}>
            Cancel
          </Button>
          <Tooltip
            title={!isFormValid && !isPending ? "Select a service provider for at least one environment to enable save" : ""}
            placement="top"
          >
            <span>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={!isFormValid || isPending}
              >
                {isPending ? "Saving…" : "Save"}
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Stack>
    </PageLayout>
  );
};

export default AddLLMProviderComponent;
