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

import { useGetAgent } from "@agent-management-platform/api-client";
import { InternalAgentOverview } from "./InternalAgentOverview";
import { useParams } from "react-router-dom";
import { ExternalAgentOverview } from "./ExternalAgentOverview";
import { useState } from "react";
import { Box, Button, Chip, Skeleton, Stack, Tooltip, Typography } from "@wso2/oxygen-ui";
import { Clock, Edit } from "@wso2/oxygen-ui-icons-react";
import { EditAgentDrawer } from "./EditAgentDrawer";
import {
    PageLayout,
    displayProvisionTypes,
} from "@agent-management-platform/views";
import { formatDistanceToNow } from "date-fns";
import type { AgentResponse } from "@agent-management-platform/types";

function AgentOverviewSkeleton() {
    return (
        <Box display="flex" flexDirection="column" gap={4} width="100%">
            <Skeleton variant="rounded" width="100%" height="40vh" />
        </Box>
    );
}

interface MetadataItemProps {
    icon?: React.ReactNode;
    label: string;
    value: string;
}

const MetadataItem: React.FC<MetadataItemProps> = ({ icon, label, value }) => (
    <Box display="flex" alignItems="center" gap={0.5}>
        {icon}
        <Typography variant="caption" color="text.secondary">{label}:</Typography>
        <Typography variant="caption" fontWeight={500}>{value}</Typography>
    </Box>
);

const AgentDescription: React.FC<{ agent: AgentResponse }> = ({ agent }) => {
    const createdAtText = agent.createdAt
        ? formatDistanceToNow(new Date(agent.createdAt), { addSuffix: true })
        : null;

    return (
        <Stack spacing={0.75}>
            {agent.description && (
                <Tooltip title={agent.description} placement="bottom-start">
                    <Typography variant="body2" color="text.secondary"
                        sx={{
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            maxWidth: "50%",
                        }}>
                        {agent.description}
                    </Typography>
                </Tooltip>
            )}
            {createdAtText && (
                <MetadataItem icon={<Clock size={12} />} label="Created" value={createdAtText} />
            )}
        </Stack>
    );
};

export function AgentOverview() {
    const { orgId, agentId, projectId } = useParams();
    const [editAgentDrawerOpen, setEditAgentDrawerOpen] = useState(false);
    const { data: agent, isLoading: isAgentLoading } = useGetAgent({
        orgName: orgId,
        projName: projectId,
        agentName: agentId,
    });

    return (
        <>
            <PageLayout
                title={agent?.displayName ?? "Agent"}
                description={agent ? <AgentDescription agent={agent} /> : undefined}
                isLoading={isAgentLoading}
                titleTail={
                    <Chip
                        label={displayProvisionTypes(agent?.provisioning?.type)}
                        color="default"
                        size="small"
                        variant="outlined"
                    />
                }
                actions={
                    <Button
                        variant="outlined"
                        size="small"
                        startIcon={<Edit size={16} />}
                        onClick={() => setEditAgentDrawerOpen(true)}
                        disabled={!agent}
                    >
                        Edit
                    </Button>
                }
            >
                {isAgentLoading ? (
                    <AgentOverviewSkeleton />
                ) : (
                    <Box display="flex" flexDirection="column" gap={4}>
                        {agent?.provisioning?.type === "internal" && <InternalAgentOverview />}
                        {agent?.provisioning?.type === "external" && <ExternalAgentOverview />}
                    </Box>
                )}
            </PageLayout>

            {agent && (
                <EditAgentDrawer
                    open={editAgentDrawerOpen}
                    onClose={() => setEditAgentDrawerOpen(false)}
                    agent={agent}
                    orgId={orgId || "default"}
                    projectId={projectId || "default"}
                />
            )}
        </>
    );
}
