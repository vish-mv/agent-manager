/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
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

import { globalConfig, type Environment } from '@agent-management-platform/types';
import { Box, Button, Skeleton, Stack } from "@wso2/oxygen-ui";
import { Settings } from "@wso2/oxygen-ui-icons-react";
import { useParams, useSearchParams } from "react-router-dom";
import { useMemo, useState } from "react";
import {
  useGetAgent,
  useListEnvironments,
} from "@agent-management-platform/api-client";
import { EnvironmentCard } from "@agent-management-platform/shared-component";
import { InstrumentationDrawer } from "./InstrumentationDrawer";
import { NoDataFound } from "@agent-management-platform/views";
import { EvalMonitorsCard } from "./EvalMonitorsCard";
import { EnvObservabilitySection } from "./EnvObservabilitySection";

export const ExternalAgentOverview = () => {
  const { agentId, orgId, projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string>("");

  const { data: agent } = useGetAgent({
    orgName: orgId,
    projName: projectId,
    agentName: agentId,
  });

  const { data: environmentList, isLoading: isEnvironmentsLoading } =
    useListEnvironments({ orgName: orgId });

  const sortedEnvironmentList = useMemo(() => {
    return [...(environmentList ?? [])].sort((_a: Environment, b: Environment) => {
      if (b.isProduction) return -1;
      return 0;
    });
  }, [environmentList]);

  const agentInstrumentationUrl = globalConfig.instrumentationUrl || "http://localhost:22893/otel";

  const handleSetupAgent = (environmentId: string) => {
    setSelectedEnvironmentId(environmentId);
    setSearchParams({ setup: "true" });
  };

  return (
    <>
      <Box display="flex" flexDirection="column" gap={2}>
        {orgId && projectId && agentId && (
          <EvalMonitorsCard
            orgId={orgId}
            projectId={projectId}
            agentId={agentId}
          />
        )}
        {isEnvironmentsLoading ? (
          <Box display="flex" flexDirection="column" gap={2}>
            <Skeleton variant="rounded" height={100} />
            <Skeleton variant="rounded" height={100} />
          </Box>
        ) : sortedEnvironmentList.length === 0 ? (
          <NoDataFound
            message="No environments found"
            subtitle="Environments will appear here once they are created"
          />
        ) : (
          <Stack spacing={2}>
            {sortedEnvironmentList.map(
              (environment: Environment) =>
                environment && orgId && projectId && agentId && (
                  <EnvironmentCard
                    key={environment.name}
                    external
                    orgId={orgId}
                    projectId={projectId}
                    agentId={agentId}
                    environment={environment}
                    actions={
                      <Button
                        variant="text"
                        size="small"
                        startIcon={<Settings size={16} />}
                        onClick={() => handleSetupAgent(environment.id ?? "")}
                      >
                        Setup Agent
                      </Button>
                    }
                    bottomContent={
                      <EnvObservabilitySection
                        orgId={orgId}
                        projectId={projectId}
                        agentId={agentId}
                        envId={environment.name}
                        hideMetrics
                        external
                      />
                    }
                  />
                )
            )}
          </Stack>
        )}
      </Box>
      <InstrumentationDrawer
        open={searchParams.get("setup") === "true"}
        onClose={() => setSearchParams({})}
        agentId={agentId ?? ""}
        orgName={orgId ?? "default"}
        projName={projectId ?? "default"}
        agentName={agentId ?? ""}
        environment={
          sortedEnvironmentList?.find((env: Environment) => env.id === selectedEnvironmentId)?.name
        }
        instrumentationUrl={agentInstrumentationUrl}
        componentUid={agent?.uuid}
        environmentUid={selectedEnvironmentId}
      />
    </>
  );
};
