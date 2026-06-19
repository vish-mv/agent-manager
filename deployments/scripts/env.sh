# Shared cluster environment variables — sourced by all scripts in this directory.
OPENCHOREO_VERSION="1.1.1"
CLUSTER_NAME="openchoreo-local-setup"
CLUSTER_CONTEXT="k3d-${CLUSTER_NAME}"

# WSO2 API Platform / Gateway Operator versions
GATEWAY_OPERATOR_VERSION="0.7.0"
GATEWAY_CHART_VERSION="1.1.0"

# OpenChoreo community module versions compatible with OpenChoreo 1.1.1
OBSERVABILITY_LOGS_OPENSEARCH_VERSION="0.4.1"
OBSERVABILITY_TRACING_OPENSEARCH_VERSION="0.4.1"
OBSERVABILITY_METRICS_PROMETHEUS_VERSION="0.6.1"

# Agent Sandbox community module
AGENT_SANDBOX_MODULE_VERSION="0.1.1"    # helm chart version — update when new releases land
AGENT_SANDBOX_UPSTREAM_VERSION="v0.4.6" # upstream controller version (default in chart)
