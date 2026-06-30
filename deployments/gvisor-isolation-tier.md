# gVisor Isolation Tier — Design, Setup & Troubleshooting

Reference for the gVisor work on `as-phase2-test`. Covers what it does, how it's wired,
and — most importantly — how to diagnose the "pod runs but observability/try-it is empty
on the gVisor node" symptom.

> Kata is covered in its own doc now — see [kata-isolation-tier.md](kata-isolation-tier.md).
> The backend maps `kata → runtimeClassName: kata-qemu`, and `make setup-kata` /
> `install-kata.sh` install the Kata runtime on a dedicated, nested-virt-capable node
> (same no-downtime, dedicated-node model as gVisor below).

---

## 1. Goal

Agents run as **sandboxed pods** (the agent-sandbox controller renders a `SandboxTemplate`
+ `SandboxWarmPool`). By default they use **runc**. We add an optional stronger tier,
**gVisor (`runsc`)** — a userspace kernel that intercepts syscalls before they reach the
host — without any downtime for existing runc agents.

The catch: installing `runsc` reconfigures containerd and restarts it. We never do that to a
node serving production agents.

---

## 2. Approach: add a dedicated gVisor node (no downtime)

Add **one new, empty node** to the *existing* cluster and install runsc only on it. The
server node and every running runc agent are untouched.

- A runc environment's `SandboxTemplate` renders **byte-identical** before and after this
  work — the new `runtimeClassName` field is omitted for runc via `oc_omit()`, so no pod
  restart.
- Promotion is additive — promoting to a gVisor env writes only the *target* binding.

The gVisor node is **labeled** `gvisor=true` and **tainted** `gvisor=true:NoSchedule`:
the label is what the RuntimeClass schedules onto; the taint keeps runc pods off.

---

## 3. How it works end to end

Isolation tier is an **environment-level** attribute.

1. **Create env** with a tier → stored as annotation `openchoreo.dev/isolation-tier` on the
   Environment CR.
2. On **deploy / promote / settings update**, the service maps tier → runtime class
   (`buildComponentTypeEnvConfigs` in `services/agent_manager.go`): `gvisor → runtimeClassName: gvisor`;
   runc → nothing.
3. That value is written into the release binding's `ComponentTypeEnvironmentConfigs`.
4. The agent-api **ComponentType** sets `runtimeClassName` on the `SandboxTemplate` pod spec
   (omitted for runc).
5. The **`gvisor` RuntimeClass** `scheduling` stanza auto-injects the matching nodeSelector +
   toleration into any pod that requests it → the pod lands on the gVisor node and runs under
   runsc. (This is exactly the agent-sandbox-native mechanism:
   <https://agent-sandbox.sigs.k8s.io/docs/use-cases/gvisor-isolation/>.)

```
Env (annotation isolation-tier=gvisor)
  └─ deploy/promote → release binding (runtimeClassName: gvisor)
       └─ ComponentType → SandboxTemplate (runtimeClassName: gvisor)
            └─ RuntimeClass "gvisor" scheduling → pod on gVisor node, runsc kernel
```

---

## 4. Files (current layout)

**Backend (Go)** — isolation tier plumbed through env create/response, deploy/promote/settings
(`runtimeClassForIsolationTier` + `buildComponentTypeEnvConfigs`), and an idempotent
`EnsureReleaseBindingRuntimeClass` reconcile called from `GetAgentDeployments` (see §6d).

**Platform resources** — `deployments/helm-charts/wso2-amp-platform-resources-extension/templates/component-types/agent-api.yaml`:
conditional `runtimeClassName` on the SandboxTemplate + a `runtimeClassName` env-config field.

**Scripts & manifests**
- `deployments/setup/setup-gvisor-node.sh` — **local k3d**: add a runsc node to the running
  cluster (no downtime). `make setup-gvisor`.
- `deployments/setup/install-gvisor.sh` — **production**: run on each Linux node to install
  runsc + configure containerd (`systemctl restart containerd` only).
- `deployments/k8s/gvisor-runtimeclass.yaml` — the RuntimeClass + scheduling.
- `deployments/setup/env.sh` — `GVISOR_*` vars incl. `GVISOR_NETWORK_HOST`.
- `deployments/scripts/add-environment.sh` — `ISOLATION_TIER` support.

**Observability** — `deployments/setup/setup-openchoreo.sh` installs Fluent Bit with
`tolerations[operator=Exists]` so the log DaemonSet runs on the tainted gVisor node.

---

## 5. Use it

**Local (k3d):**
```bash
make setup          # normal cluster (now also fixes the broken ComponentType/Makefile/Go — see §7)
make setup-gvisor   # add the gVisor node + RuntimeClass + Fluent Bit toleration

# create a gVisor environment
ISOLATION_TIER=gvisor ENV_NAME=gvisor-dev DISPLAY_NAME="gVisor Dev" \
  AGENT_MANAGER_TOKEN=<token> bash deployments/scripts/add-environment.sh
```
Then deploy/promote an agent to that env.

**Production (Linux nodes):** on each gVisor node run `install-gvisor.sh`, then apply
`deployments/k8s/gvisor-runtimeclass.yaml`, label+taint the node, and ensure Fluent Bit
tolerates the taint (the install script prints the exact commands).

---

## 6. Observability data paths (why things fail where they do)

Telemetry egress goes **through the data-plane gateway**, so it shares the gVisor node's
cross-node path with "try-it":

| Signal   | Path | Fails on the gVisor node when… |
|----------|------|-------------------------------|
| **Logs**    | Fluent Bit DaemonSet (per node) tails container logs → ships to OpenSearch | (a) Fluent Bit isn't scheduled (taint, no toleration) — **fixed**; or (b) the node can't reach OpenSearch (cross-node) |
| **Traces**  | agent pod → `…-gateway-runtime.openchoreo-data-plane:22893/otel` → otel-collector → OpenSearch | the agent pod can't reach the gateway Service (cross-node) |
| **Metrics** | Prometheus (server node) scrapes the node's kubelet/cAdvisor | Prometheus can't reach the gVisor node, or cAdvisor under runsc (see caveat) |
| **Try-it**  | client → gateway → agent Service → agent pod | the gateway can't reach the pod (cross-node); also the first-deploy API-publish gap (§6d) |

The otel-collector and Prometheus are **central Deployments reached via a Service** — the
taint does **not** block them. Only Fluent Bit (a DaemonSet) needs the toleration. So if
*traces + metrics + try-it* are all empty while the pod is `Running`, the cause is almost
always **broken cross-node networking on the gVisor node**, not taints.

**Metrics caveat:** cAdvisor reads per-container stats from cgroups; under runsc the workload
is a single sandbox process, so container-granular metrics can be partial even when
networking is healthy. Pod-level CPU/memory normally still appears.

---

## 7. Bugs fixed in this branch (pre-existing, from the hand-retyped upstream merge)

These broke runc too and are unrelated to gVisor — fixed so the platform installs/builds:

- **`agent-api.yaml` ComponentType was invalid YAML** — `sandbox-warmpool` and `hpa` were
  indented 2 spaces (rest of the list is 4), and the HPA `averageUtilization` expression was
  truncated. `helm template` failed (`line 183: did not find expected key`), so the
  `wso2-amp-platform-resources-extension` chart could not render at all. **Fixed** (uniform
  4-space list + restored `${environmentConfigs.autoscaling.cpuUtilizationPercentage}`).
- **`Makefile` `setup-sandbox` recipe used spaces, not a tab** → `Makefile:89: *** missing
  separator` broke **every** `make` target. **Fixed** (tab).
- **`agent-manager-service` did not compile** — `LastDeployedAt` was `time.Time` in
  `models.DeploymentResponse` but produced/consumed as `*time.Time`. **Fixed** (field is now
  `*time.Time`, nil = never deployed).

---

## 8. Troubleshooting runbook — "pod runs but no logs/metrics/traces, try-it not deployed"

This is the exact symptom seen on GCP. Work top-down.

### Step 0 — confirm the pod landed on the gVisor node under runsc
```bash
kubectl get pod <pod> -n <ns> -o wide                                   # NODE == k3d-gvisor-0
kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.runtimeClassName}'    # gvisor
kubectl exec <pod> -n <ns> -- dmesg 2>/dev/null | head -3               # gVisor boot lines
```

### Step 1 — is cross-node networking the problem? (the decisive test)
Run a throwaway pod **on the gVisor node** and have it reach a Service on the server node.
Do it twice — once under runc, once under runsc — to localize the fault:

```bash
# (a) runc pod on the gVisor node (tolerate the taint, pin via nodeName)
kubectl run nc-runc --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"nodeName":"k3d-gvisor-0","tolerations":[{"operator":"Exists"}]}}' \
  -- sh -c 'nslookup kubernetes.default && echo OK; sleep 1'
kubectl logs nc-runc; kubectl delete pod nc-runc

# (b) runsc pod on the gVisor node
kubectl run nc-runsc --image=busybox:1.36 --restart=Never \
  --overrides='{"spec":{"runtimeClassName":"gvisor"}}' \
  -- sh -c 'nslookup kubernetes.default && echo OK; sleep 1'
kubectl logs nc-runsc; kubectl delete pod nc-runsc
```
(`setup-gvisor-node.sh` runs an automated version of (b) at the end and warns if it fails.)

Interpret:
- **(a) fails too** → the **k3d node itself** has broken pod networking (flannel/CNI), not
  gVisor. Recreate the node: `k3d node delete k3d-gvisor-0 && make setup-gvisor`. Confirm
  the node container shares the cluster's Docker network and `host.k3d.internal` resolves.
- **(a) works, (b) fails** → it's **runsc netstack** vs your overlay. Fix below.

### Step 2 — fix runsc networking (when (b) fails)
Re-run with host-network passthrough — runsc keeps full **syscall** isolation but uses the
host network stack inside the pod netns (the reliable choice on flannel/VXLAN overlays):
```bash
GVISOR_NETWORK_HOST=true make setup-gvisor          # local k3d
# production: GVISOR_NETWORK_HOST=true sudo -E bash deployments/setup/install-gvisor.sh
```
Re-run Step 1(b) to confirm, then redeploy the agent.

### Step 3 — logs still empty though networking is fine
Ensure Fluent Bit covers the gVisor node:
```bash
kubectl get daemonset fluent-bit -n openchoreo-observability-plane   # DESIRED should include the gVisor node
kubectl get pods -n openchoreo-observability-plane -o wide | grep fluent-bit | grep gvisor
```
If missing, the toleration didn't apply — patch it:
```bash
kubectl patch daemonset fluent-bit -n openchoreo-observability-plane --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/tolerations","value":[{"operator":"Exists"}]}]'
```

### Step 4 — "try-it not deployed" though the pod is healthy and reachable
This is the **first-deploy API-publish gap** (affects runc too): on a brand-new agent the API
isn't published to the gateway until a second deploy. The reconcile in `GetAgentDeployments`
self-heals only the `runtimeClassName`, not the API publish. Re-deploy the agent, or hit the
deploy-status endpoint once, then retry Try-It.

---

## 9. Still open / caveats

- **API-publish on first deploy (chat-404)** — pre-existing, affects all agents; needs a
  larger reconcile (recompute the full trait/API set), tracked separately.
- **Metrics granularity under runsc** — see §6 caveat.
- **gVisor inherent limits** — no eBPF tooling; `/proc` is synthetic; small per-syscall overhead.
- **`kubectl port-forward` to a gVisor pod is not supported** (a gVisor limitation, per the
  agent-sandbox docs). Use the Service/gateway path — which is how agents are reached anyway.
