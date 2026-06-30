#!/bin/bash


set -euo pipefail


SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# env.sh and utils.sh live in deployments/setup/ (this script is in deployments/scripts/).
source "$SCRIPT_DIR/../setup/env.sh"
source "$SCRIPT_DIR/../setup/utils.sh"


echo "=== Installing Agent Sandbox module ==="


if ! kubectl cluster-info --context "$CLUSTER_CONTEXT" &>/dev/null; then
   echo "❌ K3d cluster '$CLUSTER_CONTEXT' is not running."
   echo "   Run: make setup-k3d setup-openchoreo"
   exit 1
fi


kubectl config use-context "$CLUSTER_CONTEXT"


echo "📦 Installing/Upgrading Agent Sandbox module..."
helm upgrade --install agent-sandbox \
   oci://ghcr.io/openchoreo/helm-charts/agent-sandbox \
   --version "$AGENT_SANDBOX_MODULE_VERSION" \
   --namespace openchoreo-data-plane \
   --create-namespace \
   --wait \
   --timeout 10m \
   --set namespace=openchoreo-control-plane \
   --set dataPlaneNamespace=openchoreo-data-plane \
   --set dataPlaneServiceAccount=cluster-agent-dataplane \
   --set upstream.version="$AGENT_SANDBOX_UPSTREAM_VERSION"


echo "⏳ Waiting for Agent Sandbox controller to be ready..."
kubectl wait -n agent-sandbox-system \
   --for=condition=available \
   --timeout=180s \
   deployment/agent-sandbox-controller


echo "🔍 Verifying Agent Sandbox CRDs..."
kubectl get crd \
   sandboxtemplates.extensions.agents.x-k8s.io \
   sandboxwarmpools.extensions.agents.x-k8s.io \
   sandboxclaims.extensions.agents.x-k8s.io


echo "🔍 Verifying RBAC for data plane service account..."
kubectl get clusterrole openchoreo-agent-sandbox-access


echo "✅ Agent Sandbox module installed successfully"