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
    useGetAgent,
    useGetAgentBuilds,
    useListEnvironments,
} from "@agent-management-platform/api-client";
import {
    Box,
    Stack,
} from "@wso2/oxygen-ui";
import { useParams } from "react-router-dom";
import { useMemo } from "react";

import { EnvironmentCard } from "@agent-management-platform/shared-component";
import { KindInfoCard } from "./KindInfoCard";
import { EvalMonitorsCard } from "./EvalMonitorsCard";
import { EnvObservabilitySection } from "./EnvObservabilitySection";
import { AgentInfoCard } from "./AgentInfoCard";

export const InternalAgentOverview = () => {
    const { orgId, agentId, projectId } = useParams();
    const { data: agent } = useGetAgent({
        orgName: orgId,
        projName: projectId,
        agentName: agentId,
    });
    const { data: buildList, isLoading: isBuildsLoading } = useGetAgentBuilds({
        orgName: orgId,
        projName: projectId,
        agentName: agentId,
    });
    const { data: environmentList } = useListEnvironments({
        orgName: orgId,
    });

    const sortedEnvironmentList = useMemo(() => {
        return [...(environmentList ?? [])].sort((_a, b) => {
            if (b.isProduction) return -1;
            return 0;
        });
    }, [environmentList]);

    const isKindAgent = !!agent?.kindName;

    return (
        <Box display="flex" flexDirection="column" gap={2}>
            {isKindAgent ? (
                <KindInfoCard
                    orgId={orgId ?? ""}
                    kindName={agent!.kindName!}
                    framework={agent?.agentType?.type}
                    model={agent?.agentType?.subType}
                />
            ) : (
                orgId && projectId && agentId && (
                    <AgentInfoCard
                        orgId={orgId}
                        projectId={projectId}
                        agentId={agentId}
                        repository={agent?.provisioning?.repository}
                        latestBuild={buildList?.builds[0]}
                        isBuildsLoading={isBuildsLoading}
                        framework={agent?.agentType?.type}
                        model={agent?.agentType?.subType}
                        build={agent?.build}
                    />
                )
            )}

            {orgId && projectId && agentId && (
                <EvalMonitorsCard
                    orgId={orgId}
                    projectId={projectId}
                    agentId={agentId}
                />
            )}

            <Stack spacing={2}>
                {sortedEnvironmentList.map(
                    (environment) =>
                        environment && orgId && projectId && agentId && (
                            <EnvironmentCard
                                key={environment.name}
                                orgId={orgId}
                                projectId={projectId}
                                agentId={agentId}
                                environment={environment}
                                bottomContent={
                                    <EnvObservabilitySection
                                        orgId={orgId}
                                        projectId={projectId}
                                        agentId={agentId}
                                        envId={environment.name}
                                    />
                                }
                            />
                        ),
                )}
            </Stack>
        </Box>
    );
};
