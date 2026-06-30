#!/bin/bash
set -euo pipefail

# Creates a new environment and installs its API Platform Gateway.
#
# All inputs are provided via environment variables so the script can be piped
# directly into bash:
#
#   curl -fsSL https://raw.githubusercontent.com/wso2/ai-agent-management-platform/main/deployments/scripts/add-environment.sh \
#     | ENV_NAME=staging \
#       DISPLAY_NAME="Staging" \
#       AGENT_MANAGER_TOKEN=<token> \
#       bash
#
# Add IS_PRODUCTION=true for a production environment.
#
# The console resolves a unique ENV_NAME via POST /orgs/{org}/utils/generate-name
# and renders the full command for the user. Re-running with the same ENV_NAME
# is idempotent.
#
# Prerequisites:
#   - kubectl and helm must be configured
#   - AGENT_MANAGER_TOKEN: bearer token authorized to create environments
#   - ENV_NAME: resource name (lowercase alphanumeric with hyphens)
#   - DISPLAY_NAME: human-readable name
#   - CHART_VERSION: gateway-extension chart version, pinned to the platform
#     release so an added env runs the same chart. Injected by the console.
# Optional:
#   - IS_PRODUCTION (default: false)
#   - ORG_NAME (default: default), DATAPLANE_REF (default: default)
#   - AGENT_MANAGER_URL (default: http://localhost:9000)
#   - ENV_INGRESS_HOST (default: am-gateway.localhost): agent-facing gateway host.
#   - ENV_INGRESS_HTTPS_HOST (default: unset): on TLS deployments, advertises an
#     https listener variant. Set ENV_INGRESS_HTTPS_HOST=$ENV_INGRESS_HOST for
#     the TLS toggle alone; without it the deployed-agent invoke URL is empty.
#   - ENV_INGRESS_HTTPS_PORT (default: 443): port for the https listener variant.

# --- Required inputs ---
: "${ENV_NAME:?ENV_NAME is required (e.g. ENV_NAME=staging)}"
: "${DISPLAY_NAME:?DISPLAY_NAME is required (e.g. DISPLAY_NAME=\"Staging\")}"
: "${AGENT_MANAGER_TOKEN:?AGENT_MANAGER_TOKEN is required (bearer token)}"
: "${CHART_VERSION:?CHART_VERSION is required (e.g. CHART_VERSION=0.15.0)}"

IS_PRODUCTION="${IS_PRODUCTION:-false}"
case "$IS_PRODUCTION" in
    true|false) ;;
    *)
        echo "❌ IS_PRODUCTION must be 'true' or 'false' (got '${IS_PRODUCTION}')"
        exit 1
        ;;
esac

if ! printf '%s' "$ENV_NAME" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?$'; then
    echo "❌ Invalid ENV_NAME '${ENV_NAME}'"
    echo "   Must be lowercase alphanumeric with hyphens (no leading/trailing hyphen)."
    exit 1
fi

# --- Configuration (can be overridden via env vars) ---
ORG_NAME="${ORG_NAME:-default}"

# The APIGateway controller materializes a Service named
# "api-platform-<org>-<env>-gateway-gateway-runtime" (24-char suffix), which
# must stay within k8s's 63-char metadata.name limit.
# So: len(env) <= 63 - 13 ("api-platform-") - 1 ("-") - 24 - len(org) = 25 - len(org)
MAX_ENV_NAME_LEN=$((25 - ${#ORG_NAME}))
if [ "${#ENV_NAME}" -gt "$MAX_ENV_NAME_LEN" ]; then
    echo "❌ ENV_NAME '${ENV_NAME}' is ${#ENV_NAME} characters; max ${MAX_ENV_NAME_LEN} for org '${ORG_NAME}'"
    echo "   The gateway Service name would exceed Kubernetes' 63-char limit."
    echo "   Use a shorter env name (e.g. 'staging' instead of 'staging-environment')."
    exit 1
fi
DATAPLANE_REF="${DATAPLANE_REF:-default}"
AGENT_MANAGER_URL="${AGENT_MANAGER_URL:-http://localhost:9000}"
AGENT_MANAGER_API_URL="${AGENT_MANAGER_API_URL:-${AGENT_MANAGER_URL}/api/v1}"
GATEWAY_NAMESPACE="${GATEWAY_NAMESPACE:-openchoreo-data-plane}"

CHART_REF="oci://ghcr.io/wso2/wso2-amp-api-platform-gateway-extension"

echo "📌 Using chart version: ${CHART_VERSION}"

# Port the gateway runtime is exposed on (matches values.yaml gateway.vhost default).
GATEWAY_VHOST_PORT="${GATEWAY_VHOST_PORT:-19080}"

# Base URL the gateway uses to reach Agent Manager. Both /api/v1 and the
# unauthenticated /auth/external/jwks.json endpoint are served from this host:port
# by AMS
AGENT_MANAGER_INTERNAL_BASE_URL="${AGENT_MANAGER_INTERNAL_BASE_URL:-http://host.docker.internal:9000}"
AGENT_MANAGER_INTERNAL_CP="${AGENT_MANAGER_INTERNAL_CP:-host.docker.internal:9243}"
AGENT_MANAGER_INTERNAL_API="${AGENT_MANAGER_INTERNAL_BASE_URL}/api/v1"
AGENT_MANAGER_INTERNAL_JWKS="${AGENT_MANAGER_INTERNAL_BASE_URL}/auth/external/jwks.json"

echo "=== Adding Environment: ${DISPLAY_NAME} (${ENV_NAME}) ==="
echo ""

# --- Step 0: Verify Agent Manager is reachable ---
echo "⏳ Checking Agent Manager is healthy..."
MAX_WAIT=30
ELAPSED=0
until curl -sf "${AGENT_MANAGER_URL}/healthz" > /dev/null 2>&1; do
    if [ "$ELAPSED" -ge "$MAX_WAIT" ]; then
        echo "❌ Agent Manager not reachable at ${AGENT_MANAGER_URL}/healthz after ${MAX_WAIT}s"
        exit 1
    fi
    sleep 3
    ELAPSED=$((ELAPSED + 3))
done
echo "✅ Agent Manager is healthy"

AUTH_HEADER="Authorization: Bearer ${AGENT_MANAGER_TOKEN}"
# Escape backslashes and double quotes so the display name survives JSON embedding.
DISPLAY_NAME_JSON=$(printf '%s' "${DISPLAY_NAME}" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')

# --- Step 1: Create environment ---
echo ""
echo "🌍 Creating environment '${ENV_NAME}'..."

ENV_INGRESS_HOST="${ENV_INGRESS_HOST:-am-gateway.localhost}"
ENV_INGRESS_HTTPS_HOST="${ENV_INGRESS_HTTPS_HOST:-}"
ENV_INGRESS_HTTPS_PORT="${ENV_INGRESS_HTTPS_PORT:-443}"

# Build the external listener set. Always advertise http; add an https variant when
# ENV_INGRESS_HTTPS_HOST is set (TLS deployments). The console reads the https
# endpoint variant when tlsEnabled=true, and an Environment's external gateway
# wholly replaces the dataplane's, so an http-only override on a TLS platform leaves
# the deployed-agent invoke URL empty (try-out then 405s against the console host).
EXTERNAL_LISTENERS="\"http\": {\"host\": \"${ENV_INGRESS_HOST}\", \"port\": ${GATEWAY_VHOST_PORT}}"
if [ -n "${ENV_INGRESS_HTTPS_HOST}" ]; then
    EXTERNAL_LISTENERS="${EXTERNAL_LISTENERS}, \"https\": {\"host\": \"${ENV_INGRESS_HTTPS_HOST}\", \"port\": ${ENV_INGRESS_HTTPS_PORT}}"
fi

# Optional pod runtime isolation tier for this environment. "gvisor" makes agents run
# under the runsc RuntimeClass (requires a gVisor node — see `make setup-gvisor`); "kata"
# makes them run under the kata-qemu RuntimeClass in a lightweight VM (requires a Kata node
# with nested virtualization — see `make setup-kata`). Empty (default) uses the standard
# runc runtime. Only include the field in the payload when set, so runc environments send
# the exact same request body as before.
ISOLATION_TIER="${ISOLATION_TIER:-}"
ISOLATION_TIER_FIELD=""
if [ -n "${ISOLATION_TIER}" ]; then
    ISOLATION_TIER_FIELD="\"isolationTier\": \"${ISOLATION_TIER}\","
    echo "   Isolation tier: ${ISOLATION_TIER}"
fi

ENV_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${AGENT_MANAGER_API_URL}/orgs/${ORG_NAME}/environments" \
    -H "${AUTH_HEADER}" \
    -H "Content-Type: application/json" \
    -d "{
        \"name\": \"${ENV_NAME}\",
        \"displayName\": \"${DISPLAY_NAME_JSON}\",
        ${ISOLATION_TIER_FIELD}
        \"dataplaneRef\": \"${DATAPLANE_REF}\",
        \"dnsPrefix\": \"${ENV_NAME}\",
        \"isProduction\": ${IS_PRODUCTION},
        \"gateway\": {
            \"ingress\": {
                \"external\": {
                    ${EXTERNAL_LISTENERS}
                }
            }
        }
    }")

ENV_HTTP_CODE=$(echo "$ENV_RESPONSE" | tail -1)
ENV_BODY=$(echo "$ENV_RESPONSE" | sed '$d')

if [ "$ENV_HTTP_CODE" = "201" ]; then
    echo "✅ Environment '${ENV_NAME}' created"
elif [ "$ENV_HTTP_CODE" = "409" ]; then
    echo "ℹ️  Environment '${ENV_NAME}' already exists, continuing..."
else
    echo "❌ Failed to create environment (HTTP ${ENV_HTTP_CODE})"
    echo "   Response: ${ENV_BODY}"
    exit 1
fi

# --- Step 2: Helm install the gateway ---
echo ""
echo "🌐 Installing API Platform Gateway for '${ENV_NAME}'..."

# Release name must match the gateway runtime service lookup expected by
# the kgateway routes (api-platform-<org>-<env> derives from _helpers.tpl
# apiGatewayName). DO NOT duplicate the org segment.
RELEASE_NAME="api-platform-${ORG_NAME}-${ENV_NAME}"
# Truncate to 53 chars to stay within Helm's release-name limit, stripping
# any trailing hyphens left by truncation.
RELEASE_NAME=$(echo "$RELEASE_NAME" | head -c 53 | sed 's/-*$//')

helm upgrade --install "${RELEASE_NAME}" \
    "${CHART_REF}" \
    --version "${CHART_VERSION}" \
    --namespace "${GATEWAY_NAMESPACE}" \
    --set agentManager.orgName="${ORG_NAME}" \
    --set gateway.environment="${ENV_NAME}" \
    --set gateway.displayName="${DISPLAY_NAME} API Platform Gateway" \
    --set gateway.vhost="http://${ENV_NAME}-${ORG_NAME}.gateway.localhost:${GATEWAY_VHOST_PORT}" \
    --set agentManager.apiUrl="${AGENT_MANAGER_INTERNAL_API}" \
    --set apiGateway.controlPlane.host="${AGENT_MANAGER_INTERNAL_CP}" \
    --set apiGateway.controlPlane.tls.insecureSkipVerify=true \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[0].name=agent-manager-service" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[0].issuer=agent-manager-service" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[0].jwks.remote.uri=${AGENT_MANAGER_INTERNAL_JWKS}" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[0].jwks.remote.skipTlsVerify=true" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[1].name=ThunderKeyManager" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[1].issuer=http://thunder.amp.localhost:8080" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[1].jwks.remote.uri=http://amp-thunder-extension-service.amp-thunder:8090/oauth2/jwks" \
    --set "apiGateway.config.policyConfigurations.jwtauth_v1.keymanagers[1].jwks.remote.skipTlsVerify=true"

# --- Step 3: Wait for gateway to be ready ---
GATEWAY_NAME="api-platform-${ORG_NAME}-${ENV_NAME}"
echo ""
echo "⏳ Waiting for gateway '${GATEWAY_NAME}' to be ready..."
if kubectl wait --for=condition=Programmed "apigateway/${GATEWAY_NAME}" -n "${GATEWAY_NAMESPACE}" --timeout=180s 2>/dev/null; then
    echo "✅ Gateway is programmed"
else
    echo "⚠️  Gateway did not become ready in time — check: kubectl get apigateway ${GATEWAY_NAME} -n ${GATEWAY_NAMESPACE}"
fi

echo ""
echo "=== Environment '${ENV_NAME}' setup complete ==="
echo ""
echo "  Environment:     ${ENV_NAME}"
echo "  Display Name:    ${DISPLAY_NAME}"
echo "  Gateway Runtime: ${ENV_NAME}-${ORG_NAME}.gateway.${ENV_INGRESS_HOST}:${GATEWAY_VHOST_PORT}"
echo ""
