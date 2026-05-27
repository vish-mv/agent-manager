"""Thin client for agent-manager-service REST API — used by the heavy-tier
driver to provision an agent per cell against the snapshot cluster.

This module is a scaffold. The full client mirrors what
`test/e2e/framework/shared_agent.go` does in Go: fetch a Thunder OAuth2
access token, then create project → create agent (with the right
instrumentation_version) → trigger build → poll until ready → collect the
endpoint URL + API key. Implementing the full flow in Python is deferred —
Phase 7 commits the structure; Phase 8 fills in bodies once a heavy-tier
snapshot exists to validate against.

Cross-reference for the Go reference flow:
- `test/e2e/framework/auth.go` — Thunder OAuth2 client_credentials grant
- `test/e2e/framework/shared_agent.go` — SharedAgent provisioning sequence
- `test/e2e/operations/agent/*.go` — per-step REST calls
- `agent-manager-service/instrumentation/baseline.json` — catalog of
  instrumentation versions the server accepts on build requests
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class IdpCredentials:
    """Thunder OAuth2 client_credentials grant inputs."""

    token_url: str  # e.g. http://thunder.amp.localhost:8080/oauth2/token
    client_id: str  # e.g. amp-api-client
    client_secret: str


@dataclass
class DeployedAgent:
    project_name: str
    agent_name: str
    endpoint_url: str
    api_key: str

    # Observer query keys. The observer's GET /api/v1/traces requires
    # (namespace, project, component, environment, startTime, endTime).
    # The driver records these at deploy time so observer.poll_traces can
    # form a valid query without re-discovery.
    namespace: str
    component: str
    environment: str


class AmpClient:
    """REST client for agent-manager-service.

    Authenticates against Thunder IDP via OAuth2 `client_credentials` grant
    (see `IdpCredentials` and `HEAVY-TIER-DEPLOY.md` for the env-var
    contract). Tokens are short-lived and refreshed proactively.
    """

    def __init__(self, base_url: str, idp: IdpCredentials):
        self.base_url = base_url.rstrip("/")
        self.idp = idp
        self._token: str | None = None
        self._token_expires_at: float = 0.0

    def access_token(self) -> str:
        """Return a current access token, refreshing if within 30s of expiry."""
        raise NotImplementedError(
            "Token fetch is a scaffold. See test/e2e/framework/auth.go for "
            "the client_credentials flow this needs to implement (Phase 8)."
        )

    def deploy_agent(
        self,
        *,
        cell_id: str,
        instrumentation_version: str,
        framework_package: str,
        framework_version: str,
        python_version: str,
    ) -> DeployedAgent:
        """Create a project + agent + build with the cell's pins; return the
        endpoint URL and API key.

        The build request carries the matrix cell's pinned versions:
        - `instrumentation_version` → controls which init-container image
          ships traceloop_version.
        - `framework_package==framework_version` → patched into the agent's
          requirements.txt before build.
        - `python_version` → picks the Python base image for the build.

        Returns once the build reports `Ready`. Raises on timeout.
        """
        raise NotImplementedError(
            "Heavy-tier deploy is a scaffold. See HEAVY-TIER-DEPLOY.md and "
            "test/e2e/framework/shared_agent.go for the REST-API flow this "
            "needs to implement (Phase 8)."
        )

    def teardown_agent(self, deployed: DeployedAgent) -> None:
        """Delete the agent + project. Called from a finally block per cell."""
        raise NotImplementedError(
            "Heavy-tier teardown — see HEAVY-TIER-DEPLOY.md (Phase 8)."
        )
