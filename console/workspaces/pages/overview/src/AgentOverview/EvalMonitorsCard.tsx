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

import React, { useMemo } from "react";
import {
    Box,
    Button,
    Card,
    CardContent,
    Divider,
    IconButton,
    Skeleton,
    Typography,
} from "@wso2/oxygen-ui";
import { ChevronRight, ExternalLink } from "@wso2/oxygen-ui-icons-react";
import {
    useListMonitors,
    useMonitorScores,
} from "@agent-management-platform/api-client";
import {
    absoluteRouteMap,
    TraceListTimeRange,
    type EvaluatorScoreSummary,
    type MonitorResponse,
} from "@agent-management-platform/types";
import { generatePath, Link } from "react-router-dom";
import { DonutIcon, type DonutColor } from "./DonutIcon";

interface EvalMonitorsCardProps {
    orgId: string;
    projectId: string;
    agentId: string;
}

const getMean = (evaluators: EvaluatorScoreSummary[]): number | null => {
    const means = evaluators
        .map((e) => e.aggregations?.["mean"])
        .filter((v): v is number => typeof v === "number");
    if (means.length === 0) return null;
    return means.reduce((a, b) => a + b, 0) / means.length;
};

const getScoreColor = (p: number | null): DonutColor => {
    if (p === null) return "primary";
    if (p >= 70) return "success";
    if (p >= 40) return "warning";
    return "error";
};

interface MonitorTileProps {
    monitor: MonitorResponse;
    orgId: string;
    projectId: string;
    agentId: string;
}

const MonitorTile: React.FC<MonitorTileProps> = ({ monitor, orgId, projectId, agentId }) => {
    const { data: scoresData, isLoading } = useMonitorScores(
        { orgName: orgId, projName: projectId, agentName: agentId, monitorName: monitor.name },
        { timeRange: TraceListTimeRange.SEVEN_DAYS },
    );

    const scorePercent = useMemo(() => {
        if (!scoresData) return null;
        const mean = getMean(scoresData.evaluators);
        return mean !== null ? (mean * 100) : null;
    }, [scoresData]);

    const monitorHref = generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents
            .children.evaluation.children.monitor.children.view.path,
        { orgId, projectId, agentId, monitorId: monitor.name },
    );

    const evaluatorNames = monitor.evaluators.map((e) => e.displayName).join(" · ");
    const color = getScoreColor(scorePercent);

    return (
        <Card variant="outlined">
            <CardContent sx={{ display: "flex", alignItems: "center", gap: 2, "&:last-child": { pb: 1.5 } }}>
                {isLoading ? (
                    <Skeleton variant="circular" width={52} height={52} />
                ) : (
                    <DonutIcon percent={scorePercent ?? 0} color={color} size={72} />
                )}
                <Box minWidth={0} flex={1} overflow="hidden">
                    {isLoading ? (
                        <Skeleton variant="text" width={48} />
                    ) : (
                        <Typography variant="h6" lineHeight={1.2}>
                            {scorePercent !== null ? `${scorePercent.toFixed(2)}%` : "—"}
                        </Typography>
                    )}
                    <Box display="flex" alignItems="center" gap={0.5} minWidth={0}>
                        <Typography variant="body2" noWrap fontWeight={500}>
                            {monitor.displayName || monitor.name}
                        </Typography>
                        <IconButton
                            size="small"
                            component={Link}
                            to={monitorHref}
                            sx={{ p: 0.25, flexShrink: 0 }}
                        >
                            <ExternalLink size={12} />
                        </IconButton>
                    </Box>
                    {evaluatorNames && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block" title={evaluatorNames}>
                            {evaluatorNames}
                        </Typography>
                    )}
                </Box>
            </CardContent>
        </Card>
    );
};

export const EvalMonitorsCard: React.FC<EvalMonitorsCardProps> = ({
    orgId, projectId, agentId,
}) => {
    const { data: monitorsList, isLoading } = useListMonitors({
        orgName: orgId,
        projName: projectId,
        agentName: agentId,
    });

    const monitors = monitorsList?.monitors ?? [];

    if (!isLoading && monitors.length === 0) {
        return null;
    }

    const allMonitorsHref = generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents
            .children.evaluation.children.monitor.path,
        { orgId, projectId, agentId },
    );

    const gridSx = {
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" },
        gap: 1.5,
    };

    return (
        <Card variant="outlined">
            <CardContent>
                <Box display="flex" justifyContent="space-between" alignItems="center" pb={1}>
                    <Typography variant="h6">Agent Performance</Typography>
                    <Button
                        size="small"
                        variant="text"
                        endIcon={<ChevronRight size={14} />}
                        component={Link}
                        to={allMonitorsHref}
                        sx={{ minWidth: 0 }}
                    >
                        View all
                    </Button>
                </Box>
                <Divider sx={{ mb: 1.5 }} />
                {isLoading ? (
                    <Box sx={gridSx}>
                        {[1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={96} />)}
                    </Box>
                ) : (
                    <Box sx={gridSx}>
                        {monitors.map((monitor) => (
                            <MonitorTile
                                key={monitor.name}
                                monitor={monitor}
                                orgId={orgId}
                                projectId={projectId}
                                agentId={agentId}
                            />
                        ))}
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};
