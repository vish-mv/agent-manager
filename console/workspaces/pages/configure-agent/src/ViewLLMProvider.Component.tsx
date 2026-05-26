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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerWrapper,
  PageLayout,
  TextInput,
} from "@agent-management-platform/views";
import { CodeBlock } from "@agent-management-platform/shared-component";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Form,
  FormLabel,
  IconButton,
  ListingTable,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { AlertTriangle, BookOpen, Pencil } from "@wso2/oxygen-ui-icons-react";
import { generatePath, useLocation, useNavigate, useParams } from "react-router-dom";
import { absoluteRouteMap } from "@agent-management-platform/types";
import {
  useGetAgent,
  useGetAgentModelConfig,
  useListCatalogLLMProviders,
  useListEnvironments,
  useListLLMProviderTemplates,
  useUpdateAgentModelConfig,
} from "@agent-management-platform/api-client";
import {
  GuardrailsSection,
  type GuardrailSelection,
} from "@agent-management-platform/llm-providers";
import { ProviderDisplay } from "./AddLLMProvider.Component";
import { ProviderSelectDrawer } from "./ProviderSelectDrawer";

function generateDisplayName(key: string): string {
  switch (key) {
    case "apikey":
      return "API Key for authenticating with the LLM provider";
    case "url":
      return "Base URL of the LLM provider";
    default:
      return key.replace(/([A-Z])/g, " $1").replace(/^./, (str) => str.toUpperCase()); // Add space before capital letters and capitalize the first letter

  }
}

function getClientSetupSnippet(
  templateId: string | undefined,
  varKeys: string[],
): { importLine: string; setup: string } | null {
  if (!templateId) return null;
  const urlKey = varKeys.find((k) => /url/i.test(k));
  const apiKeyKey = varKeys.find((k) => /key/i.test(k));

  const build = (
    importLine: string,
    lines: (string | null)[],
  ) => ({
    importLine,
    setup: lines.filter(Boolean).join("\n"),
  });

  switch (templateId) {
    case "openai":
      return build("from openai import OpenAI", [
        "client = OpenAI(",
        urlKey ? `    base_url=${urlKey},` : null,
        `    api_key="",`,
        `    default_headers={"API-Key": ${apiKeyKey}, "Authorization": ""}`,
        ")",
      ]);
    case "anthropic":
      return build("from anthropic import Anthropic", [
        "client = Anthropic(",
        urlKey ? `    base_url=${urlKey},` : null,
        `    default_headers={"API-Key": ${apiKeyKey}, "Authorization": ""}`,
        ")",
      ]);
    case "azure-openai":
    case "azureai-foundry":
      return build("from openai import AzureOpenAI", [
        "client = AzureOpenAI(",
        urlKey ? `    azure_endpoint=${urlKey},` : null,
        `    api_key="",`,
        `    default_headers={"API-Key": ${apiKeyKey}, "Authorization": ""}`,
        ")",
      ]);
    case "mistralai":
      return build("import httpx\nfrom mistralai import Mistral", [
        `_http_client = httpx.Client(headers={"API-Key": ${apiKeyKey}, "Authorization": ""})`,
        "client = Mistral(",
        urlKey ? `    server_url=${urlKey},` : null,
        "    client=_http_client,",
        ")",
      ]);
    case "gemini":
      return build("from google import genai\nfrom google.genai import types", [
        urlKey
          ? `_http_options = types.HttpOptions(base_url=${urlKey}, client_args={"headers": {"API-Key": ${apiKeyKey}, "Authorization": ""}})`
          : `_http_options = types.HttpOptions(client_args={"headers": {"API-Key": ${apiKeyKey}, "Authorization": ""}})`,
        "client = genai.Client(",
        `    http_options=_http_options`,
        ")",
      ]);
    case "awsbedrock":
      return build("import boto3\nfrom botocore import UNSIGNED\nfrom botocore.config import Config", [
        "client = boto3.client(",
        `    "bedrock-runtime",`,
        urlKey ? `    endpoint_url=${urlKey},` : null,
        `    config=Config(signature_version=UNSIGNED),`,
        ")",
        `def _add_headers(request, **kwargs):`,
        `    request.headers["API-Key"] = ${apiKeyKey}`,
        `    request.headers["Authorization"] = ""`,
        `client.meta.events.register("before-send", _add_headers)`,
      ]);
    default:
      return null;
  }
}

export const ViewLLMProviderComponent: React.FC = () => {
  const { orgId, projectId, agentId, configId } = useParams<{
    orgId: string;
    projectId: string;
    agentId: string;
    configId: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();

  type AuthInfoEntry = {
    type: string;
    in: string;
    name: string;
    value?: string;
  };
  const authInfoByEnv = (
    location.state as {
      authInfoByEnv?: Record<string, AuthInfoEntry>;
    }
  )?.authInfoByEnv;

  const [selectedEnvIndex, setSelectedEnvIndex] = useState(0);
  const [guardrailsByEnv, setGuardrailsByEnv] = useState<
    Record<string, GuardrailSelection[]>
  >({});
  const [envVarNames, setEnvVarNames] = useState<Record<string, string>>({});
  const [snippetTab, setSnippetTab] = useState(0);
  // Open panel automatically on first visit after creation
  const [panelOpen, setPanelOpen] = useState(!!authInfoByEnv);
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false);
  // pending provider uuid per env — set when user picks in the drawer, applied on save
  const [pendingProviderByEnv, setPendingProviderByEnv] = useState<Record<string, string>>({});

  const backHref =
    orgId && projectId && agentId
      ? generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents
          .children.configure.path,
        { orgId, projectId, agentId },
      )
      : "#";

  const {
    data: config,
    isLoading,
    isError,
  } = useGetAgentModelConfig({
    orgName: orgId,
    projName: projectId,
    agentName: agentId,
    configId,
  });

  const { data: environments = [] } = useListEnvironments({
    orgName: orgId,
  });

  const { data: agent } = useGetAgent({
    orgName: orgId,
    projName: projectId,
    agentName: agentId,
  });

  const isExternal = agent?.provisioning?.type === "external";

  const { data: catalogData } = useListCatalogLLMProviders(
    { orgName: orgId },
    { limit: 50 },
  );

  const { data: templatesData } = useListLLMProviderTemplates({
    orgName: orgId,
  });

  const updateConfig = useUpdateAgentModelConfig();

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
        template: e.template,
        version: e.version,
        deployments: e.deployments,
        security: e.security,
        rateLimiting: e.rateLimiting,
        policies: e.policies,
      })),
    [catalogData],
  );

  useEffect(() => {
    if (!config) return;

    const nextNames: Record<string, string> = {};
    for (const ev of config.environmentVariables ?? []) {
      nextNames[ev.key] = ev.name;
    }
    setEnvVarNames(nextNames);

    const nextByEnv: Record<string, GuardrailSelection[]> = {};
    for (const [envName, m] of Object.entries(config.envMappings ?? {})) {
      const envPolicies = m.configuration?.policies ?? [];
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
      nextByEnv[envName] = envGuardrails;
    }
    setGuardrailsByEnv(nextByEnv);
  }, [config]);

  const selectedEnvName = useMemo(
    () => environments[selectedEnvIndex]?.name ?? "",
    [environments, selectedEnvIndex],
  );

  const envMapping = useMemo(
    () => config?.envMappings?.[selectedEnvName],
    [config, selectedEnvName],
  );

  const providerConfig = envMapping?.configuration;

  const catalogProvider = useMemo(() => {
    if (!providerConfig?.providerName || !catalogData?.entries)
      return undefined;
    return catalogData.entries.find(
      (e) => e.handle === providerConfig.providerName,
    );
  }, [providerConfig?.providerName, catalogData]);

  const templateLogo = useMemo(() => {
    if (!catalogProvider?.template || !templatesData?.templates)
      return undefined;
    const tpl = templatesData.templates.find(
      (t) => t.id === catalogProvider.template,
    );
    return tpl?.metadata?.logoUrl;
  }, [catalogProvider, templatesData]);

  const templateDisplayName = useMemo(() => {
    if (!catalogProvider?.template || !templatesData?.templates)
      return undefined;
    const tpl = templatesData.templates.find(
      (t) => t.id === catalogProvider.template,
    );
    return tpl?.name;
  }, [catalogProvider, templatesData]);

  const guardrails = useMemo(
    () => guardrailsByEnv[selectedEnvName] ?? [],
    [guardrailsByEnv, selectedEnvName],
  );

  const isDirty = useMemo(() => {
    if (!config) return false;

    // Check pending provider changes
    if (Object.keys(pendingProviderByEnv).length > 0) return true;

    // Check env var names
    for (const ev of config.environmentVariables ?? []) {
      if ((envVarNames[ev.key] ?? ev.name) !== ev.name) return true;
    }

    // Check guardrails
    for (const [envName, m] of Object.entries(config.envMappings ?? {})) {
      const origPolicies = m.configuration?.policies ?? [];
      const edited = guardrailsByEnv[envName] ?? [];
      if (origPolicies.length !== edited.length) return true;
      for (let i = 0; i < origPolicies.length; i++) {
        const orig = origPolicies[i];
        const edit = edited[i];
        if (orig.name !== edit?.name || orig.version !== edit?.version) return true;
        const origParams = orig.paths?.[0]?.params ?? {};
        const editParams = edit?.settings ?? {};
        if (JSON.stringify(origParams) !== JSON.stringify(editParams)) return true;
      }
    }

    return false;
  }, [config, envVarNames, guardrailsByEnv]);

  const handleAddGuardrail = useCallback(
    (guardrail: GuardrailSelection) => {
      setGuardrailsByEnv((prev) => {
        const envList = prev[selectedEnvName] ?? [];
        if (
          envList.some(
            (g) =>
              g.name === guardrail.name && g.version === guardrail.version,
          )
        )
          return prev;
        return { ...prev, [selectedEnvName]: [...envList, guardrail] };
      });
    },
    [selectedEnvName],
  );

  const handleEditGuardrail = useCallback(
    (guardrail: GuardrailSelection) => {
      setGuardrailsByEnv((prev) => {
        const envList = prev[selectedEnvName] ?? [];
        return {
          ...prev,
          [selectedEnvName]: envList.map((g) =>
            g.name === guardrail.name && g.version === guardrail.version
              ? guardrail
              : g,
          ),
        };
      });
    },
    [selectedEnvName],
  );

  const handleRemoveGuardrail = useCallback(
    (gName: string, gVersion: string) => {
      setGuardrailsByEnv((prev) => {
        const envList = prev[selectedEnvName] ?? [];
        return {
          ...prev,
          [selectedEnvName]: envList.filter(
            (g) => !(g.name === gName && g.version === gVersion),
          ),
        };
      });
    },
    [selectedEnvName],
  );

  const handleSave = useCallback(() => {
    if (!orgId || !projectId || !agentId || !configId || !config) return;

    const envMappings: Record<
      string,
      {
        providerName?: string;
        configuration: {
          policies?: {
            name: string;
            version: string;
            paths: {
              path: string;
              methods: string[];
              params: Record<string, unknown>;
            }[];
          }[];
        };
      }
    > = {};

    for (const [envName, mapping] of Object.entries(
      config.envMappings ?? {},
    )) {
      const pConfig = mapping.configuration;
      if (pConfig) {
        // Resolve provider name: use pending selection if changed, else keep original
        const pendingUuid = pendingProviderByEnv[envName];
        const resolvedProviderName = pendingUuid
          ? (providers.find((p) => p.uuid === pendingUuid)?.id ?? pConfig.providerName)
          : pConfig.providerName;

        const envGuardrails = guardrailsByEnv[envName];
        if (envGuardrails !== undefined) {
          // Environment was edited — build policies from edited guardrails
          const envPolicies =
            envGuardrails.length > 0
              ? envGuardrails.map((g) => ({
                name: g.name,
                version: g.version,
                paths: [
                  {
                    path: "/*",
                    methods: ["*"],
                    params: g.settings ?? {},
                  },
                ],
              }))
              : undefined;
          envMappings[envName] = {
            providerName: resolvedProviderName,
            configuration: { policies: envPolicies },
          };
        } else {
          // Environment not loaded — preserve original policies intact
          envMappings[envName] = {
            providerName: resolvedProviderName,
            configuration: {
              policies: pConfig.policies?.map((p) => ({
                name: p.name,
                version: p.version,
                paths: p.paths.map((pp) => ({
                  path: pp.path,
                  methods: pp.methods,
                  params: pp.params ?? {},
                })),
              })),
            },
          };
        }
      }
    }

    updateConfig.mutate(
      {
        params: {
          orgName: orgId,
          projName: projectId,
          agentName: agentId,
          configId,
        },
        body: {
          name: config.name,
          envMappings,
          environmentVariables: Object.keys(envVarNames).length > 0
            ? Object.entries(envVarNames).map(([key, n]) => ({
              key,
              name: n.trim(),
            }))
            : undefined,
        },
      },
      {
        onSuccess: () => {
          setPendingProviderByEnv({});
        },
      },
    );
  }, [
    orgId,
    projectId,
    agentId,
    configId,
    config,
    guardrailsByEnv,
    envVarNames,
    pendingProviderByEnv,
    providers,
    updateConfig,
    navigate,
    backHref,
  ]);

  if (isLoading) {
    return (
      <PageLayout
        title="LLM Configuration"
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

  if (isError || !config) {
    return (
      <PageLayout
        title="LLM Configuration"
        backHref={backHref}
        disableIcon
        backLabel="Back to Configure"
      >
        <Alert severity="error" icon={<AlertTriangle size={18} />}>
          Configuration not found or failed to load.
        </Alert>
      </PageLayout>
    );
  }

  const apiKeyValue = providerConfig?.authInfo?.value;

  const pageTitle = catalogProvider?.name
    ?? providerConfig?.providerName
    ?? config.name;

  const showPanel = (isExternal && !!providerConfig) || (!isExternal && (config.environmentVariables?.length ?? 0) > 0);

  const envVarsPanel = showPanel && (
    <DrawerWrapper
      open={panelOpen}
      onClose={(_, reason) => { if (isExternal && reason === "backdropClick") return; setPanelOpen(false); }}
      minWidth={640}
      maxWidth={640}
    >
      <DrawerHeader
        icon={<BookOpen size={24} />}
        title={isExternal ? "Connect to LLM Provider" : "Environment Variables & Integration Guide"}
        onClose={() => setPanelOpen(false)}
      />
      <DrawerContent>
        <Stack spacing={3}>
        {isExternal && providerConfig && (() => {
          const authEntry = authInfoByEnv?.[selectedEnvName];
          const apiKeyEnvVar = config.environmentVariables?.find((ev) => ev.key === "apikey");
          const headerName = authEntry?.name || "Authorization";
          const headerValue = authEntry?.value || (apiKeyEnvVar ? `$${apiKeyEnvVar.name}` : "<api-key>");
          const curlCode = [
            `curl -X POST ${providerConfig.url || "<endpoint-url>"}`,
            `  --header "${headerName}: ${headerValue}"`,
            `  -d '{"model": "", "messages": [{"role": "user", "content": "Hi..."}]}'`,
          ].join(" \\\n");
          return (
            <Stack spacing={2}>
              {!authEntry && (
                <Alert severity="info">
                  <Typography variant="body2">
                    The credentials for this provider were issued during initial setup. To route
                    your agent&apos;s traffic through the governance layer, configure your client
                    with the provided endpoint and API key.
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, fontWeight: 600 }}>
                    Security Reminder: Credentials are only displayed once at creation time.
                  </Typography>
                </Alert>
              )}
              {authEntry && (
                <>
                  <Alert severity="info">
                    <Typography variant="body2">
                      To route your agent&apos;s LLM traffic through the governance layer,
                      configure your client with the credentials below.
                    </Typography>
                  </Alert>
                  <Alert severity="warning">
                    <Typography variant="body2" fontWeight={600}>
                      Make sure to copy your API key now — you will not be able to see it again.
                    </Typography>
                  </Alert>
                </>
              )}
              {Boolean(providerConfig.url) && (
                <TextInput
                  label="Endpoint URL"
                  value={providerConfig.url ?? ""}
                  copyable
                  copyTooltipText="Copy Endpoint URL"
                  slotProps={{ input: { readOnly: true } }}
                  size="small"
                />
              )}
              {authEntry && (
                <TextInput
                  label="Header Name"
                  value={authEntry.name}
                  copyable
                  copyTooltipText="Copy Header Name"
                  slotProps={{ input: { readOnly: true } }}
                  size="small"
                />
              )}
              {authEntry?.value && (
                <TextInput
                  label="API Key"
                  type="password"
                  value={authEntry.value}
                  copyable
                  copyTooltipText="Copy API Key"
                  slotProps={{ input: { readOnly: true } }}
                  size="small"
                />
              )}
              {apiKeyValue && (
                <TextInput
                  label="API Key"
                  type="password"
                  value={apiKeyValue}
                  copyable
                  copyTooltipText="Copy API Key"
                  slotProps={{ input: { readOnly: true } }}
                  size="small"
                />
              )}
              <Box>
                <FormLabel sx={{ display: "block", mb: 0.5 }}>Example cURL</FormLabel>
                <CodeBlock code={curlCode} language="bash" fieldId="curl" />
              </Box>
            </Stack>
          );
        })()}
        {!isExternal && isDirty && !updateConfig.isError && (
          <Alert
            severity="warning"
            action={
              <Stack direction="row" spacing={1} alignItems="center">
                <Button size="small" variant="outlined" onClick={() => { setPanelOpen(false); navigate(backHref); }}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleSave}
                  disabled={updateConfig.isPending}
                >
                  {updateConfig.isPending ? "Saving…" : "Save changes"}
                </Button>
              </Stack>
            }
          >
            You have unsaved changes.
          </Alert>
        )}

        {!isExternal && <>
          <Stack spacing={1}>
            <Typography variant="subtitle1" fontWeight={600}>Environment Variable Names</Typography>
            <Typography variant="body2" color="text.secondary">
              These variable names are injected into the agent at runtime with environment-specific values. Rename them here if your code already uses different names — then save.
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
                  {config.environmentVariables.map((envVar) => (
                    <ListingTable.Row key={envVar.key}>
                      <ListingTable.Cell>
                        <TextInput
                          value={envVarNames[envVar.key] ?? envVar.name}
                          onChange={(e) =>
                            setEnvVarNames((prev) => ({
                              ...prev,
                              [envVar.key]: e.target.value,
                            }))
                          }
                          copyable
                          copyTooltipText={`Copy ${envVarNames[envVar.key] ?? envVar.name}`}
                          size="small"
                        />
                      </ListingTable.Cell>
                      <ListingTable.Cell>
                        <Typography variant="body2" color="text.secondary">
                          {generateDisplayName(envVar.key)}
                        </Typography>
                      </ListingTable.Cell>
                    </ListingTable.Row>
                  ))}
                </ListingTable.Body>
              </ListingTable>
            </ListingTable.Container>
          </Stack>

          <Divider />

          <Stack spacing={2}>
            <Stack spacing={0.5}>
              <Typography variant="subtitle1" fontWeight={600}>Integration Guide</Typography>
              <Typography variant="body2" color="text.secondary">
                Copy the snippet below into your agent code. The environment variables will be injected automatically at runtime — do not hardcode their values.
              </Typography>
            </Stack>
            <ToggleButtonGroup
              size="small"
              value={snippetTab}
              exclusive
              color="primary"
              onChange={(_, v: number | null) => { if (v !== null) setSnippetTab(v); }}
            >
              <ToggleButton value={0} sx={{ textTransform: "none" }}>Python</ToggleButton>
              <ToggleButton value={1} sx={{ textTransform: "none" }}>Copilot Prompt</ToggleButton>
            </ToggleButtonGroup>

            {snippetTab === 0 && (
              <CodeBlock
                language="python"
                code={(() => {
                  const clientSetup = getClientSetupSnippet(
                    catalogProvider?.template,
                    config.environmentVariables.map((ev) => ev.key),
                  );
                  const imports = ["import os"];
                  if (clientSetup) imports.push(clientSetup.importLine);
                  const envVars = config.environmentVariables.map(
                    (envVar) =>
                      `${envVar.key} = os.environ.get('${envVarNames[envVar.key] ?? envVar.name}')`,
                  );
                  const parts = [imports.join("\n"), "", ...envVars];
                  if (clientSetup) parts.push("", clientSetup.setup);
                  return parts.join("\n");
                })()}
              />
            )}

            {snippetTab === 1 && (
              <CodeBlock
                language="markdown"
                code={(() => {
                  const providerName = templateDisplayName
                    ?? catalogProvider?.name
                    ?? providerConfig?.providerName
                    ?? "the LLM provider";
                  const envVarList = config.environmentVariables
                    .map(
                      (ev) =>
                        `- ${generateDisplayName(ev.key)}: \`${envVarNames[ev.key] ?? ev.name}\``,
                    )
                    .join("\n");
                  return [
                    `Update my code to use ${providerName}.`,
                    "",
                    "Environment variables that will be injected at runtime:",
                    envVarList,
                    "",
                    "Requirements:",
                    `- Read the environment variables listed above to configure the client for ${providerName}.`,
                    `- Initialize the ${providerName} client with the URL and API key from those variables.`,
                    "- Do not hardcode any secrets or endpoint URLs.",
                    "- Keep the rest of my code unchanged.",
                  ].join("\n");
                })()}
              />
            )}
          </Stack>
        </>}
        </Stack>
      </DrawerContent>
    </DrawerWrapper>
  );

  return (
    <PageLayout
      title={pageTitle}
      backHref={backHref}
      disableIcon
      backLabel="Back to Configure"
      actions={
        showPanel ? (
          <Button
            variant="outlined"
            size="small"
            startIcon={<BookOpen size={16} />}
            onClick={() => setPanelOpen(true)}
          >
            {isExternal ? "Connect to LLM Provider" : "Environment Variables & Integration Guide"}
          </Button>
        ) : undefined
      }
    >
      <Stack spacing={3}>
        {updateConfig.isError && (
          <Alert
            severity="error"
            icon={<AlertTriangle size={18} />}
            onClose={() => updateConfig.reset()}
          >
            {updateConfig.error instanceof Error
              ? updateConfig.error.message
              : "Failed to update configuration. Please try again."}
          </Alert>
        )}

        <Form.Section>
          <Form.Header>Service Provider</Form.Header>
          <Stack spacing={3}>

            {environments.length > 1 && (
              <>
                <Typography variant="body2" color="text.secondary">
                  Each environment uses a separate catalog provider. 
                  The same variable names are injected in all environments with 
                  environment-specific values.
                </Typography>
                <Tabs
                  value={selectedEnvIndex}
                  onChange={(_, v: number) => setSelectedEnvIndex(v)}
                  sx={{ mb: 2 }}
                >
                  {environments.map((enTab, idx) => (
                    <Tab
                      key={enTab.name}
                      label={enTab.displayName ?? enTab.name}
                      value={idx}
                    />
                  ))}
                </Tabs>
              </>
            )}


            <ProviderSelectDrawer
              open={providerDrawerOpen}
              onClose={() => setProviderDrawerOpen(false)}
              providers={providers}
              templateMap={templateMap}
              selectedUuid={
                pendingProviderByEnv[selectedEnvName] ??
                (catalogProvider ? catalogData?.entries?.find(
                  (e) => e.handle === providerConfig?.providerName,
                )?.uuid : undefined)
              }
              subtitle="Choose the catalog provider for this agent."
              onSelect={(uuid) =>
                setPendingProviderByEnv((prev) => ({ ...prev, [selectedEnvName]: uuid }))
              }
            />

            {providerConfig && (() => {
              const pendingUuid = pendingProviderByEnv[selectedEnvName];
              const displayProvider = pendingUuid
                ? providers.find((p) => p.uuid === pendingUuid)
                : null;
              const displayCatalog = displayProvider
                ? catalogData?.entries?.find((e) => e.uuid === pendingUuid)
                : catalogProvider;
              const displayTemplate = displayCatalog?.template
                ? templateMap.get(displayCatalog.template)
                : (catalogProvider?.template ? { displayName: templateDisplayName ?? catalogProvider.template, logoUrl: templateLogo } : null);

              return (
                <Card>
                  <CardContent sx={{ position: "relative" }}>
                    <Tooltip title="Change provider" placement="top" arrow>
                      <IconButton
                        size="small"
                        color="primary"
                        sx={{ position: "absolute", top: 8, right: 8 }}
                        onClick={() => setProviderDrawerOpen(true)}
                        aria-label="Change provider"
                      >
                        <Pencil size={16} />
                      </IconButton>
                    </Tooltip>
                    <ProviderDisplay
                      provider={
                        displayCatalog
                          ? {
                            name: displayCatalog.name ?? providerConfig.providerName ?? "",
                            template: displayCatalog.template,
                            version: displayCatalog.version,
                            deployments: displayCatalog.deployments,
                            security: displayCatalog.security,
                            rateLimiting: displayCatalog.rateLimiting,
                            policies: displayCatalog.policies,
                          }
                          : { name: providerConfig.providerName ?? "" }
                      }
                      isSelected={false}
                      hideCheckbox
                      templateInfo={displayTemplate ?? null}
                    />
                  </CardContent>
                </Card>
              );
            })()}

            <GuardrailsSection
              guardrails={guardrails}
              onAddGuardrail={handleAddGuardrail}
              onEditGuardrail={handleEditGuardrail}
              onRemoveGuardrail={handleRemoveGuardrail}
            />

            {isDirty && (
              <Stack direction="row" spacing={1} justifyContent="flex-end">
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => {
                    setPendingProviderByEnv({});
                    navigate(backHref);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleSave}
                  disabled={updateConfig.isPending}
                >
                  {updateConfig.isPending ? "Saving…" : "Save"}
                </Button>
              </Stack>
            )}

          </Stack>
        </Form.Section>

      </Stack>

      {envVarsPanel}
    </PageLayout>
  );
};

export default ViewLLMProviderComponent;
