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

import React from "react";
import {
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    Divider,
    IconButton,
    Skeleton,
    Typography,
} from "@wso2/oxygen-ui";
import {
    ChevronRight,
    CheckCircle,
    ExternalLink,
    GitHub,
    XCircle,
} from "@wso2/oxygen-ui-icons-react";
import {
    BUILD_STATUS_COLOR_MAP,
    type Build,
    type BuildResponse,
    type BuildStatus,
    type RepositoryConfig,
    absoluteRouteMap,
} from "@agent-management-platform/types";
import { format } from "date-fns";
import { generatePath, Link } from "react-router-dom";

interface AgentInfoCardProps {
    orgId: string;
    projectId: string;
    agentId: string;
    repository?: RepositoryConfig;
    latestBuild?: BuildResponse;
    isBuildsLoading?: boolean;
    framework?: string;
    model?: string;
    build?: Build;
}

export const AgentInfoCard: React.FC<AgentInfoCardProps> = ({
    orgId,
    projectId,
    agentId,
    repository,
    latestBuild,
    isBuildsLoading,
    framework,
    model,
    build,
}) => {
    const buildpackLabel = (() => {
        if (!build) return null;
        if (build.type === "buildpack") {
            const { language, languageVersion } = build.buildpack;
            return languageVersion ? `${language} ${languageVersion}` : language;
        }
        return "Docker";
    })();
    const buildsPath = generatePath(
        absoluteRouteMap.children.org.children.projects.children.agents.children.build.path,
        { orgId, projectId, agentId },
    );

    const repoUrl = repository
        ? (() => {
              const { url, branch, appPath } = repository;
              if (appPath && appPath !== "/") {
                  const normalized = appPath.startsWith("/") ? appPath.substring(1) : appPath;
                  return `${url}/tree/${branch}/${normalized}`;
              }
              return `${url}/tree/${branch}`;
          })()
        : null;

    const buildStatusIcon = (status?: BuildStatus) => {
        if (!status) return undefined;
        if (status === "Running" || status === "Pending") return <CircularProgress size={12} color="inherit" />;
        if (status === "Failed") return <XCircle size={14} />;
        return <CheckCircle size={14} />;
    };

    return (
        <Card variant="outlined">
            <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
                <Box pb={1}>
                    <Typography variant="h6">Source & Build</Typography>
                </Box>
                <Divider sx={{ mb: 1.5 }} />
                <Box display="flex" gap={2} minWidth={0}>

                    <Box flex={1} minWidth={0}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600}
                            sx={{ textTransform: "uppercase", letterSpacing: "0.05em", display: "block", mb: 0.75 }}>
                            Repository
                        </Typography>
                        <Box display="flex" alignItems="center" gap={0.5} minWidth={0}>
                            <GitHub size={14} style={{ flexShrink: 0 }} />
                            <Typography
                                variant="body2"
                                noWrap
                              
                            >
                                {repoUrl ?? "—"}
                            </Typography>
                            {repoUrl && (
                                <IconButton
                                    size="small"
                                    component="a"
                                    href={repoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    sx={{ p: 0.25, flexShrink: 0 }}
                                >
                                    <ExternalLink size={12} />
                                </IconButton>
                            )}
                        </Box>
                        {(framework || model || buildpackLabel) && (
                            <Typography variant="caption" color="text.secondary" noWrap display="block" mt={0.25}>
                                {[
                                    (framework || model) && `Agent Type: ${[framework, model].filter(Boolean).join("/")}`,
                                    buildpackLabel && `Language: ${buildpackLabel}`,
                                ]
                                    .filter(Boolean)
                                    .join("  ·  ")}
                            </Typography>
                        )}
                    </Box>

                    <Divider orientation="vertical" flexItem />

                    <Box flex={1} minWidth={0}>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={0.75}>
                            <Typography variant="caption" color="text.secondary" fontWeight={600}
                                sx={{ textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                Latest Build
                            </Typography>
                            <Button
                                size="small"
                                variant="text"
                                endIcon={<ChevronRight size={12} />}
                                component={Link}
                                to={buildsPath}
                            >
                                View all
                            </Button>
                        </Box>
                        {isBuildsLoading ? (
                            <Skeleton variant="rounded" height={28} />
                        ) : !latestBuild ? (
                            <Typography variant="body2" color="text.secondary">No builds yet.</Typography>
                        ) : (
                            <Box display="flex" alignItems="center" gap={1.5} minWidth={0}>
                                <Typography variant="body2" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                                    {latestBuild.buildParameters?.branch} :
                                </Typography>
                                <Typography variant="body2" noWrap flex={1}>
                                    {latestBuild.buildName}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" noWrap sx={{ flexShrink: 0 }}>
                                    {format(new Date(latestBuild.startedAt), "dd/MM/yyyy HH:mm:ss")}
                                </Typography>
                                <Chip
                                    label={latestBuild.status}
                                    size="small"
                                    color={BUILD_STATUS_COLOR_MAP[latestBuild.status as BuildStatus] ?? "default"}
                                    variant="outlined"
                                    icon={buildStatusIcon(latestBuild.status as BuildStatus)}
                                    sx={{ flexShrink: 0 }}
                                />
                            </Box>
                        )}
                    </Box>

                </Box>
            </CardContent>
        </Card>
    );
};
