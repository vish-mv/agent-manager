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

import { useAuthHooks } from "@agent-management-platform/auth";
import { FullPageLoader } from "@agent-management-platform/views";
import { absoluteRouteMap } from "@agent-management-platform/types";
import { Navigate, useLocation, generatePath, useParams } from "react-router-dom";
import { useListOrganizations, useListProjects } from "@agent-management-platform/api-client";

export const Protected = ({ children }: { children: React.ReactNode }) => {
    const { isAuthenticated, isLoadingIsAuthenticated } = useAuthHooks();
    const location = useLocation();
    const { data: organizations, isLoading: isLoadingOrganizations } = useListOrganizations();
    const {orgId} = useParams();

    // When authenticated without an org in the URL, land the user inside their
    // first organization. We only resolve this once organizations have loaded;
    // the project list query stays skipped (empty orgName) until then.
    const targetOrg = organizations?.organizations?.[0]?.name;
    const shouldResolveLanding =
        isAuthenticated && !isLoadingOrganizations && !!targetOrg && !orgId;
    const { data: projectList, isLoading: isLoadingProjects } = useListProjects({
        orgName: shouldResolveLanding ? targetOrg : "",
    });

    // Preserve the full location so the login flow can restore the original
    // destination (Login reads state.from.pathname).
    const navigationState = { from: location };

    if (isLoadingIsAuthenticated) {
        return <FullPageLoader />;
    }

    if (!isAuthenticated) {
        return (
            <Navigate
                to={generatePath(absoluteRouteMap.children.login.path)}
                state={navigationState}
            />
        );
    }

    // Authenticated without an org in the URL: wait for orgs (and the project
    // list) to load, then redirect to the resolved landing location instead of
    // rendering children prematurely.
    if (!orgId) {
        if (isLoadingOrganizations || (shouldResolveLanding && isLoadingProjects)) {
            return <FullPageLoader />;
        }
        if (shouldResolveLanding) {
            const projects = projectList?.projects ?? [];
            // Prefer the default project, fall back to the first available
            // project, and if the org has no projects yet, land on the org
            // overview (project listing) so the user can create one.
            const landingProject = projects.find((p) => p.name === "default") ?? projects[0];
            const landingPath = landingProject
                ? generatePath(absoluteRouteMap.children.org.children.projects.path, {
                      orgId: targetOrg,
                      projectId: landingProject.name,
                  })
                : generatePath(absoluteRouteMap.children.org.path, { orgId: targetOrg });
            return <Navigate to={landingPath} state={navigationState} />;
        }
    }

    return (
        <>
            {children}
        </>
    );
};
