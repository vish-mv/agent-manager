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
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@wso2/oxygen-ui";
import { Copy, Eye, EyeOff, Plus } from "@wso2/oxygen-ui-icons-react";
import {
  DrawerContent,
  DrawerHeader,
  DrawerWrapper,
  useFormValidation,
} from "@agent-management-platform/views";
import { useAuthHooks } from "@agent-management-platform/auth";
import { useListDataPlanes } from "@agent-management-platform/api-client";
import { globalConfig, type DataPlane } from "@agent-management-platform/types";
import {
  getAmpVersionHelm,
  getRawScriptUrl,
} from "@agent-management-platform/shared-component";
import {
  createEnvironmentSchema,
  type CreateEnvironmentFormValues,
} from "../form/environmentSchema";

const TOKEN_MASK = "•••••••••••••••";

// TODO: replace with real published doc URLs once the isolation-tier setup guides are written.
const GVISOR_ISOLATION_DOCS_URL = "https://example.com/docs/gvisor-isolation-tier";
const KATA_ISOLATION_DOCS_URL = "https://example.com/docs/kata-isolation-tier";

interface CreateEnvironmentDrawerProps {
  open: boolean;
  onClose: () => void;
  orgId: string;
}

const DEFAULT_FORM: CreateEnvironmentFormValues = {
  name: "",
  displayName: "",
  description: "",
  dataplaneRef: "",
  dnsPrefix: "",
  isProduction: false,
};

function deriveNameFromDisplayName(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildScript(
  name: string,
  displayName: string,
  isProduction: boolean,
  token: string,
): string {
  // Cluster-internal addresses the gateway uses to reach Agent Manager. Sourced
  // from runtime config so the same drawer renders the right values for
  // docker-compose (host.docker.internal) vs in-cluster (svc.cluster.local)
  // deployments. The script appends /api/v1 and /auth/external/jwks.json to the
  // base URL itself, so we only need to pipe these two values through.
  const internalBase = globalConfig.agentManagerInternalBaseUrl?.trim();
  const internalCp = globalConfig.agentManagerInternalCpHost?.trim();
  // Required by add-environment.sh: the gateway chart version, pinned to the
  // platform release version so an added environment runs the same gateway chart.

  const chartVersion = getAmpVersionHelm();

  const lines = [
    `curl -fsSL ${getRawScriptUrl("add-environment.sh")} \\`,
    `  | ENV_NAME=${name || "<env-name>"} \\`,
    `    DISPLAY_NAME="${displayName || "<display-name>"}" \\`,
    `    AGENT_MANAGER_TOKEN=${token} \\`,
    `    CHART_VERSION=${chartVersion || "<chart-version>"} \\`,
    ...(isProduction ? ["    IS_PRODUCTION=true \\"] : []),
    ...(internalBase
      ? [`    AGENT_MANAGER_INTERNAL_BASE_URL=${internalBase} \\`]
      : []),
    ...(internalCp ? [`    AGENT_MANAGER_INTERNAL_CP=${internalCp} \\`] : []),
    "    bash",
  ];
  return lines.join("\n");
}

export function CreateEnvironmentDrawer({
  open,
  onClose,
  orgId,
}: CreateEnvironmentDrawerProps) {
  const [formData, setFormData] =
    useState<CreateEnvironmentFormValues>(DEFAULT_FORM);
  const [showToken, setShowToken] = useState(false);
  const [resolvedToken, setResolvedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { errors, validateField, setFieldError } =
    useFormValidation<CreateEnvironmentFormValues>(createEnvironmentSchema);

  const { getToken } = useAuthHooks();
  const { data: dataPlanes } = useListDataPlanes({ orgName: orgId });
  const planes = dataPlanes ?? [];

  useEffect(() => {
    if (open) {
      setFormData(DEFAULT_FORM);
      setShowToken(false);
      setResolvedToken(null);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    if (!formData.dataplaneRef && planes.length > 0) {
      setFormData((prev) => ({ ...prev, dataplaneRef: planes[0].name }));
    }
  }, [planes, formData.dataplaneRef]);

  const handleChange = useCallback(
    (field: keyof CreateEnvironmentFormValues, value: string | boolean) => {
      setFormData((prev) => {
        const next = { ...prev, [field]: value } as CreateEnvironmentFormValues;
        setFieldError(field, validateField(field, next[field], next));
        return next;
      });
    },
    [validateField, setFieldError],
  );

  const handleDisplayNameChange = useCallback(
    (value: string) => {
      setFormData((prev) => {
        const derivedName = deriveNameFromDisplayName(value);
        const nameInSync =
          prev.name === "" ||
          prev.name === deriveNameFromDisplayName(prev.displayName);
        const newName = nameInSync ? derivedName : prev.name;
        const next = {
          ...prev,
          displayName: value,
          name: newName,
          dnsPrefix: newName,
        };
        setFieldError("displayName", validateField("displayName", value, next));
        setFieldError("name", validateField("name", newName, next));
        return next;
      });
    },
    [validateField, setFieldError],
  );

  const handleNameChange = useCallback(
    (value: string) => {
      setFormData((prev) => {
        const next = { ...prev, name: value, dnsPrefix: value };
        setFieldError("name", validateField("name", value, next));
        return next;
      });
    },
    [validateField, setFieldError],
  );

  const handleToggleToken = useCallback(async () => {
    if (showToken) {
      setShowToken(false);
      setResolvedToken(null);
    } else {
      try {
        const token = await getToken();
        setResolvedToken(token);
        setShowToken(true);
      } catch {
        // silently fail
      }
    }
  }, [showToken, getToken]);

  const handleCopy = useCallback(async () => {
    try {
      const token = resolvedToken ?? (await getToken());
      const script = buildScript(
        formData.name,
        formData.displayName,
        formData.isProduction ?? false,
        token,
      );
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail
    }
  }, [
    resolvedToken,
    getToken,
    formData.name,
    formData.displayName,
    formData.isProduction,
  ]);

  const displayScript = useMemo(
    () =>
      buildScript(
        formData.name,
        formData.displayName,
        formData.isProduction ?? false,
        showToken && resolvedToken ? resolvedToken : TOKEN_MASK,
      ),
    [
      formData.name,
      formData.displayName,
      formData.isProduction,
      showToken,
      resolvedToken,
    ],
  );

  return (
    <DrawerWrapper open={open} onClose={onClose}>
      <DrawerHeader
        icon={<Plus size={24} />}
        title="Create Environment"
        onClose={onClose}
      />
      <DrawerContent>
        <Stack spacing={3}>
          <Typography variant="body2" color="text.secondary">
            Environments are provisioned by a script that creates the
            environment in Agent Manager and installs its API Platform Gateway
            via Helm. Fill in the details below, then copy and run the command
            in a terminal with <code>kubectl</code> and <code>helm</code>{" "}
            configured against your cluster.
          </Typography>

          <Stack spacing={2}>
            {planes.length > 1 && (
              <FormControl fullWidth error={Boolean(errors.dataplaneRef)}>
                <FormLabel required>Data Plane</FormLabel>
                <Select
                  size="small"
                  value={formData.dataplaneRef}
                  onChange={(e) =>
                    handleChange("dataplaneRef", e.target.value as string)
                  }
                  error={Boolean(errors.dataplaneRef)}
                >
                  {planes.map((p: DataPlane) => (
                    <MenuItem key={p.name} value={p.name}>
                      {p.displayName || p.name}
                    </MenuItem>
                  ))}
                </Select>
                {errors.dataplaneRef && (
                  <Typography variant="caption" color="error">
                    {errors.dataplaneRef}
                  </Typography>
                )}
              </FormControl>
            )}

            <FormControl fullWidth error={Boolean(errors.displayName)}>
              <FormLabel required>Display Name</FormLabel>
              <TextField
                size="small"
                fullWidth
                value={formData.displayName}
                onChange={(e) => handleDisplayNameChange(e.target.value)}
                placeholder="e.g., Production"
                error={Boolean(errors.displayName)}
                helperText={errors.displayName}
              />
            </FormControl>

            <FormControl fullWidth error={Boolean(errors.name)}>
              <FormLabel>Name</FormLabel>
              <TextField
                size="small"
                fullWidth
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g., production"
                error={Boolean(errors.name)}
                helperText={
                  errors.name ??
                  "The resource name used by the API. Generated automatically and guaranteed unique."
                }
              />
            </FormControl>

            <FormControlLabel
              control={
                <Checkbox
                  checked={formData.isProduction ?? false}
                  onChange={(e) =>
                    handleChange("isProduction", e.target.checked)
                  }
                />
              }
              label="Production environment"
            />
          </Stack>

          <Alert severity="info">
            Want this environment to run under a stronger isolation tier
            (gVisor or Kata) instead of the default? Set up the node first,
            then add an{" "}
            <Typography
              component="code"
              sx={{ bgcolor: "action.hover", px: 0.5, borderRadius: 0.5 }}
            >
              ISOLATION_TIER
            </Typography>{" "}
            variable to the command below yourself before running it. See the{" "}
            <Typography
              component="a"
              href={GVISOR_ISOLATION_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: "primary.main" }}
            >
              gVisor setup guide
            </Typography>{" "}
            or the{" "}
            <Typography
              component="a"
              href={KATA_ISOLATION_DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: "primary.main" }}
            >
              Kata setup guide
            </Typography>
            .
          </Alert>

          <Stack spacing={1}>
            <Typography variant="body2">
              Run from the root of your repo clone:
            </Typography>
            <Box
              sx={{
                position: "relative",
                bgcolor: "grey.900",
                borderRadius: 1,
                p: 2,
                pr: 8,
                fontFamily: "monospace",
                fontSize: "0.8125rem",
                color: "grey.100",
                whiteSpace: "pre",
                overflowX: "auto",
              }}
            >
              <Box
                sx={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  display: "flex",
                  gap: 0.5,
                }}
              >
                <Tooltip title={showToken ? "Hide token" : "Show token"}>
                  <IconButton
                    size="small"
                    onClick={handleToggleToken}
                    sx={{ color: "grey.400" }}
                  >
                    {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                  </IconButton>
                </Tooltip>
                <Tooltip title={copied ? "Copied!" : "Copy"}>
                  <IconButton
                    size="small"
                    onClick={handleCopy}
                    sx={{ color: copied ? "success.light" : "grey.400" }}
                  >
                    <Copy size={16} />
                  </IconButton>
                </Tooltip>
              </Box>
              {displayScript}
            </Box>
            <Typography variant="caption" color="text.secondary">
              Your access token will be substituted when you copy.
            </Typography>
          </Stack>

          <Alert severity="info">
            Once the script completes, the new environment will appear in the
            list. The script is idempotent — safe to re-run.
          </Alert>

          <Box display="flex" justifyContent="flex-end">
            <Button variant="outlined" color="inherit" onClick={onClose}>
              Close
            </Button>
          </Box>
        </Stack>
      </DrawerContent>
    </DrawerWrapper>
  );
}
