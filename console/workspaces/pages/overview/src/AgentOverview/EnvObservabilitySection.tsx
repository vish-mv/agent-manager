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
    Grid,
    Skeleton,
    Stack,
    Typography,
    useTheme,
} from "@wso2/oxygen-ui";
import { AreaChart } from "@wso2/oxygen-ui-charts-react";
import { ChevronRight, PauseCircle } from "@wso2/oxygen-ui-icons-react";
import {
    useGetAgentMetrics,
    useListAgentDeployments,
    useTraceList,
} from "@agent-management-platform/api-client";
import { NoDataFound } from "@agent-management-platform/views";
import {
    absoluteRouteMap,
    TraceListTimeRange,
} from "@agent-management-platform/types";
import { format } from "date-fns";
import { generatePath, Link } from "react-router-dom";
import { DonutIcon, DonutColor } from "./DonutIcon";

interface EnvObservabilitySectionProps {
    orgId: string;
    projectId: string;
    agentId: string;
    envId: string;
    hideMetrics?: boolean;
    external?: boolean;
}

const formatCpu = (cores: number): string => {
    const milli = Math.round(cores * 1000);
    return milli >= 1000 ? `${(milli / 1000).toFixed(2)} cores` : `${milli}m`;
};

const formatMemory = (bytes: number): string => {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
};

const formatTokens = (n: number): string =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;

const formatDuration = (nanos: number): string => {
    const ms = nanos / 1_000_000;
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
};

interface MetricCardProps {
    label: string;
    value: string;
    points: Array<{ time: string; value: number }>;
    color?: string;
    isLoading?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, points, color = "currentColor", isLoading }) => (
    <Card variant="outlined" sx={{ width: "100%" }}>
        <CardContent sx={{ py: 1, px: 1.5, "&:last-child": { pb: 1 }, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
            <Box>
                {isLoading
                    ? <Skeleton variant="text" width={48} height={28} />
                    : <Typography variant="h6" lineHeight={1.2}>{value}</Typography>
                }
                <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Box>
            {isLoading
                ? <Skeleton variant="rounded" width={120} height={48} />
                : (
                    <AreaChart
                        data={points}
                        xAxisDataKey="time"
                        height={48}
                        width={120}
                        xAxis={{ show: false }}
                        yAxis={{ show: false }}
                        grid={{ show: false }}
                        tooltip={{ show: false }}
                        legend={{ show: false }}
                        margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                        areas={[{
                            dataKey: "value",
                            stroke: color,
                            fill: color,
                            fillOpacity: 0.15,
                            dot: false,
                            activeDot: false,
                            connectNulls: true,
                            isAnimationActive: false,
                            type: "monotone",
                        }]}
                    />
                )
            }
        </CardContent>
    </Card>
);

interface DonutMetricCardProps {
    label: string;
    value: string;
    percent: number;
    color: DonutColor;
    isLoading?: boolean;
}

const DonutMetricCard: React.FC<DonutMetricCardProps> =
    ({ label, value, percent, color, isLoading }) => (
        <Card variant="outlined" sx={{ width: "100%" }}>
            <CardContent sx={{ py: 1, px: 1.5, "&:last-child": { pb: 1 }, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                <Box>
                    {isLoading
                        ? <Skeleton variant="text" width={48} height={28} />
                        : <Typography variant="h6" lineHeight={1.2}>{value}</Typography>
                    }
                    <Typography variant="caption" color="text.secondary">{label}</Typography>
                </Box>
                {isLoading
                    ? <Skeleton variant="circular" width={48} height={48} />
                    : <DonutIcon percent={percent} color={color} size={48} />
                }
            </CardContent>
        </Card>
    );

interface SimpleMetricCardProps {
    label: string;
    value: string;
    limit: string | null;
    percent: number | null;
    isLoading?: boolean;
}

const SimpleMetricCard: React.FC<SimpleMetricCardProps> =
    ({ label, value, limit, percent, isLoading }) => {
        const theme = useTheme();
        const pct = Math.min(percent ?? 0, 100);
        const barColor = pct >= 85
            ? theme.vars?.palette?.error?.main
            : pct >= 60
                ? theme.vars?.palette?.warning?.main
                : theme.vars?.palette?.success?.main;

        return (
            <Card variant="outlined" sx={{ width: "100%" }}>
                <CardContent sx={{ py: 0.75, px: 1.5, "&:last-child": { pb: 0.75 } }}>
                    <Box display="flex" justifyContent="space-between" alignItems="baseline" mb={0.5}>
                        <Typography variant="caption" color="text.secondary">{label}</Typography>
                        {isLoading
                            ? <Skeleton variant="text" width={60} height={18} />
                            : (
                                <Box display="flex" alignItems="baseline" gap={0.5}>
                                    <Typography variant="caption" fontWeight={600} color="text.primary">
                                        {value}
                                    </Typography>
                                    {limit && (
                                        <Typography variant="caption" color="text.disabled">
                                            / {limit}
                                        </Typography>
                                    )}
                                    {percent !== null && (
                                        <Typography variant="caption" fontWeight={600} sx={{ color: barColor }}>
                                            {Math.round(percent)}%
                                        </Typography>
                                    )}
                                </Box>
                            )
                        }
                    </Box>
                    {isLoading
                        ? <Skeleton variant="rounded" height={4} />
                        : (
                            <Box sx={{ height: 4, borderRadius: 2, bgcolor: "action.selected", overflow: "hidden" }}>
                                <Box sx={{
                                    height: "100%",
                                    width: `${pct}%`,
                                    bgcolor: barColor,
                                    borderRadius: 2,
                                    transition: "width 0.4s ease",
                                }} />
                            </Box>
                        )
                    }
                </CardContent>
            </Card>
        );
    };

export const EnvObservabilitySection: React.FC<EnvObservabilitySectionProps> = ({
    orgId, projectId, agentId, envId, hideMetrics = false, external = false,
}) => {
    const theme = useTheme();
    const { data: deployments } = useListAgentDeployments(
        { orgName: orgId, projName: projectId, agentName: agentId },
        { enabled: !external },
    );
    const isSuspended = !external && deployments?.[envId]?.status === "suspended";

    const { data: metrics, isLoading: isMetricsLoading } = useGetAgentMetrics(
        { agentName: agentId, orgName: orgId, projName: projectId },
        { environmentName: envId },
        {
            enabled: !hideMetrics && !isSuspended,
            enableAutoRefresh: true,
            timeRange: TraceListTimeRange.ONE_HOUR,
        },
    );

    const { traceList, isLoading: isTracesLoading } = useTraceList(
        orgId, projectId, agentId, envId, TraceListTimeRange.ONE_HOUR, 30, "desc",
        undefined, undefined, { enableAutoRefresh: true },
    );

    const cpuPts = metrics?.cpuUsage ?? [];
    const latestCpu = cpuPts.length ? cpuPts[cpuPts.length - 1].value : null;
    const cpuLimitPts = metrics?.cpuLimits ?? [];
    const latestCpuLimit = cpuLimitPts.length ? cpuLimitPts[cpuLimitPts.length - 1].value : null;
    const cpuPercent = latestCpu !== null && latestCpuLimit ?
        (latestCpu / latestCpuLimit) * 100 : null;

    const memPts = metrics?.memory ?? [];
    const latestMemory = memPts.length ? memPts[memPts.length - 1].value : null;
    const memLimitPts = metrics?.memoryLimits ?? [];
    const latestMemoryLimit = memLimitPts.length ? memLimitPts[memLimitPts.length - 1].value : null;
    const memoryPercent = latestMemory !== null && latestMemoryLimit ?
        (latestMemory / latestMemoryLimit) * 100 : null;

    const traces = useMemo(() => traceList?.traces ?? [], [traceList]);

    const latencyPoints = useMemo(() =>
        [...traces].reverse().map((t) => ({
            time: format(new Date(t.startTime), "HH:mm"),
            value: Math.round(t.durationInNanos / 1_000_000),
        })),
        [traces],
    );

    const avgLatencyNanos = traces.length
        ? traces.reduce((sum, t) => sum + t.durationInNanos, 0) / traces.length
        : null;

    const tokenPoints = useMemo(() =>
        [...traces].reverse()
            .filter((t) => t.tokenUsage?.totalTokens != null)
            .map((t) => ({
                time: format(new Date(t.startTime), "HH:mm"),
                value: t.tokenUsage!.totalTokens!,
            })),
        [traces],
    );

    const avgTokens = (() => {
        const withTokens = traces.filter((t) => t.tokenUsage?.totalTokens != null);
        return withTokens.length
            ? Math.round(withTokens.reduce((sum, t) => sum +
                (t.tokenUsage?.totalTokens ?? 0), 0) / withTokens.length)
            : null;
    })();

    const scorePoints = useMemo(() =>
        [...traces].reverse()
            .filter((t) => t.score?.score != null)
            .map((t) => ({
                time: format(new Date(t.startTime), "HH:mm"),
                value: Math.round(t.score!.score! * 100),
            })),
        [traces],
    );

    const avgScore = (() => {
        const withScore = traces.filter((t) => t.score?.score != null);
        return withScore.length
            ? withScore.reduce((sum, t) => sum + (t.score?.score ?? 0), 0) / withScore.length
            : null;
    })();

    const successRate = traces.length
        ? (traces.filter((t) => (t.status?.errorCount ?? 0) === 0).length / traces.length) * 100
        : null;
    const successRateColor: DonutColor = successRate === null ? "primary"
        : successRate >= 70 ? "success"
            : successRate >= 40 ? "warning"
                : "error";

    const tracesHref = generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents
            .children.environment.children.observability.children.traces.path,
        { orgId, projectId, agentId, envId },
    );

    const metricsHref = generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents
            .children.environment.children.observability.children.metrics.path,
        { orgId, projectId, agentId, envId },
    );

    return (
        <>
            <Divider sx={{ mt: 2, mb: 1 }} />
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.5}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}
                    sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Recent Traces
                </Typography>
                <Button
                    size="small"
                    variant="text"
                    endIcon={<ChevronRight size={14} />}
                    component={Link}
                    to={tracesHref}
                    sx={{ minWidth: 0, fontSize: "0.75rem" }}
                >
                    View all
                </Button>
            </Box>
            <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        label="Avg Latency"
                        value={avgLatencyNanos !== null ? formatDuration(avgLatencyNanos) : "—"}
                        points={latencyPoints}
                        color={theme.vars?.palette?.info?.main}
                        isLoading={isTracesLoading}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        label="Avg Tokens"
                        value={avgTokens !== null ? formatTokens(avgTokens) : "—"}
                        points={tokenPoints}
                        color={theme.vars?.palette?.warning?.main}
                        isLoading={isTracesLoading}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <MetricCard
                        label="Avg Score"
                        value={avgScore !== null ? `${(avgScore * 100).toFixed(1)}%` : "—"}
                        points={scorePoints}
                        color={theme.vars?.palette?.success?.main}
                        isLoading={isTracesLoading}
                    />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
                    <DonutMetricCard
                        label="Success Rate"
                        value={successRate !== null ? `${successRate.toFixed(1)}%` : "—"}
                        percent={successRate ?? 0}
                        color={successRateColor}
                        isLoading={isTracesLoading}
                    />
                </Grid>
            </Grid>
            {!hideMetrics && (isSuspended ? (
                <NoDataFound
                    iconElement={PauseCircle}
                    message="Environment Suspended"
                    subtitle="Metrics are unavailable while the environment is suspended."
                    disableBackground
                />
            ) : (
                <>
                    <Divider sx={{ mt: 1.5, mb: 1 }} />
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600}
                            sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Metrics
                        </Typography>
                        <Button
                            size="small"
                            variant="text"
                            endIcon={<ChevronRight size={14} />}
                            component={Link}
                            to={metricsHref}
                            sx={{ minWidth: 0, fontSize: "0.75rem" }}
                        >
                            View all
                        </Button>
                    </Box>
                    <Stack direction="row" spacing={0.75} sx={{ maxWidth: 400 }}>
                        <SimpleMetricCard
                            label="CPU"
                            value={latestCpu !== null ? formatCpu(latestCpu) : "—"}
                            limit={latestCpuLimit !== null ? formatCpu(latestCpuLimit) : null}
                            percent={cpuPercent}
                            isLoading={isMetricsLoading}
                        />
                        <SimpleMetricCard
                            label="Memory"
                            value={latestMemory !== null ? formatMemory(latestMemory) : "—"}
                            limit={latestMemoryLimit !== null ?
                                formatMemory(latestMemoryLimit) : null}
                            percent={memoryPercent}
                            isLoading={isMetricsLoading}
                        />
                    </Stack>
                </>
            ))}
        </>
    );
};
