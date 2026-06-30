# Kata Containers Isolation Tier — Design, Setup & Troubleshooting

Reference for the Kata work. Covers what it does, how it's wired, and how it differs from
the gVisor tier. Read [gvisor-isolation-tier.md](gvisor-isolation-tier.md) first — Kata reuses
the same end-to-end plumbing; this doc only calls out what's Kata-specific.

---

## 1. Goal

Agents run as **sandboxed pods** (the agent-sandbox controller renders a `SandboxTemplate` +
`SandboxWarmPool`). By default they use **runc** (shared host kernel). gVisor adds a userspace
kernel; **Kata** goes further — each agent boots in a **lightweight VM with its own guest
kernel** (QEMU/KVM), so there is *no shared kernel* with the host. This is the strongest tier,
for the most untrusted / multi-tenant workloads.

The mechanism is the agent-sandbox-native one: set `runtimeClassName: kata-qemu` on the pod.
<https://agent-sandbox.sigs.k8s.io/docs/use-cases/kata-containers-isolation/>

---

## 2. Hard requirement: nested virtualization (KVM)

Kata-qemu boots a real VM, so the node **must expose `/dev/kvm`** (nested virtualization).

- ✅ Bare-metal Linux, or a nested-virt cloud VM: **GCP Intel N2** + `--enable-nested-virtualization`, Ubuntu/containerd image.
- ❌ **macOS / Colima** — no nested virt; Kata pods hang in `ContainerCreating`. Use gVisor locally; test Kata on a KVM-capable Linux host/VM.
- ❌ GCP E2, AMD N2D, ARM T2A, and Container-Optimized OS (read-only) — unsupported.

Check on a node: `ls -l /dev/kvm` and `cat /sys/module/kvm_intel/parameters/nested` → `Y`.

---

## 3. Approach: dedicated Kata node (no downtime)

Same model as gVisor — add **one new node** and install Kata only on it. The server node and
every running runc agent are untouched.

- The Kata node is **labeled `kata=true`** and **tainted `kata=true:NoSchedule`**. The label is
  what the RuntimeClass schedules onto (and scopes the installer); the taint keeps runc pods off.
- A runc env's `SandboxTemplate` renders **byte-identical** (the `runtimeClassName` field is
  omitted for runc via `oc_omit()`), so no pod restart for existing agents.

### Two install paths (why they differ)

| | Where | Mechanism | Script |
|---|---|---|---|
| **Production** | Real Linux nodes (systemd) | upstream **kata-deploy** DaemonSet installs the full Kata stack + reconfigures containerd via systemctl | `deployments/setup/install-kata.sh` |
| **Dev (k3d)** | k3d node container (no systemd) | install the **Kata static tarball** into the node + write the k3s `config.toml.tmpl` + `docker restart` to reload — the same proven trick as `setup-gvisor-node.sh` | `make setup-kata` / `setup-kata-node.sh` |

Both scope the install to the `kata=true` node only, so the server node's containerd is never
touched. kata-deploy is scoped by injecting a `nodeSelector` into its DaemonSet **before** apply
(so it never lands on the server node, even briefly).

---

## 4. How it works end to end

Identical to gVisor, only the tier string and runtime class change.

1. **Create env** with `isolationTier: kata` → annotation `openchoreo.dev/isolation-tier: kata`
   on the Environment CR.
2. On **deploy / promote / settings update**, `runtimeClassForIsolationTier` maps
   `kata → "kata-qemu"` (see `services/agent_manager.go`), written into the release binding's
   `ComponentTypeEnvironmentConfigs.runtimeClassName`.
3. The agent-api **ComponentType** sets `runtimeClassName: kata-qemu` on the `SandboxTemplate`
   pod spec (omitted for runc).
4. The **`kata-qemu` RuntimeClass** `scheduling` stanza auto-injects the matching nodeSelector
   (`kata=true`) + toleration → the pod lands on the Kata node and boots a VM.
5. `EnsureReleaseBindingRuntimeClass` / `reconcileIsolationRuntimeClass` self-heal the
   runtimeClassName on out-of-band bindings (AutoDeploy), same as gVisor.

```
Env (annotation isolation-tier=kata)
  └─ deploy/promote → release binding (runtimeClassName: kata-qemu)
       └─ ComponentType → SandboxTemplate (runtimeClassName: kata-qemu)
            └─ RuntimeClass "kata-qemu" scheduling → pod on Kata node, QEMU VM + guest kernel
```

> **Key detail:** the tier name stays `kata` at the API, but the rendered RuntimeClass is
> `kata-qemu` — that's the handler kata-deploy / the static install registers in containerd.
> Sending `runtimeClassName: kata` would fail with `no handler found`.

---

## 5. Files

**Backend (Go)** — `runtimeClassForIsolationTier` (`services/agent_manager.go`) maps
`kata → "kata-qemu"`. Everything else (`buildComponentTypeEnvConfigs`,
`reconcileIsolationRuntimeClass`, `EnsureReleaseBindingRuntimeClass`, env create/response,
the `isolation-tier` annotation) is tier-agnostic and already worked.

**Platform resources** — `helm-charts/.../component-types/agent-api.yaml`: the conditional
`runtimeClassName` is generic (`environmentConfigs.runtimeClassName != "" ? … : oc_omit()`),
so it carries `kata-qemu` with no change.

**Scripts & manifests**
- `deployments/setup/setup-kata-node.sh` — **dev/k3d**: add a Kata node to the running cluster (`make setup-kata`).
- `deployments/setup/install-kata.sh` — **production**: kata-deploy onto labeled Linux node(s).
- `deployments/k8s/kata-runtimeclass.yaml` — the `kata-qemu` RuntimeClass + scheduling.
- `deployments/setup/env.sh` — `KATA_*` vars (`KATA_RUNTIME_CLASS=kata-qemu`, `KATA_VERSION`, label/taint keys).
- `deployments/scripts/add-environment.sh` — `ISOLATION_TIER=kata` (already generic).

**Observability** — Fluent Bit is installed with `tolerations[operator=Exists]`
(`setup-openchoreo.sh`), which already tolerates the `kata` taint — logs are collected on the
Kata node with no extra change.

---

## 6. Use it

**Dev (k3d on a KVM-capable Linux host, e.g. your GCP VM):**
```bash
make setup          # normal cluster
make setup-kata     # add the Kata node + RuntimeClass + Fluent Bit toleration
                    # (aborts if /dev/kvm is missing)

# create a Kata environment
ISOLATION_TIER=kata ENV_NAME=kata-dev DISPLAY_NAME="Kata Dev" \
  AGENT_MANAGER_TOKEN=<token> bash deployments/scripts/add-environment.sh
```
Then deploy/promote an agent to that env.

**Production (Linux nodes with nested virt):**
```bash
# label your Kata node(s), then from a machine with kubectl:
KATA_NODES="<node-a> <node-b>" bash deployments/setup/install-kata.sh
```
It **hard-fails if any target node has no `/dev/kvm`** ("Kata cannot be installed without KVM
support" — set `KATA_SKIP_KVM_CHECK=true` only if you've verified KVM out of band), then
applies kata-deploy **scoped to the labeled node(s)** (nodeSelector + a toleration injected into
the DaemonSet *before* apply, so the server/gVisor nodes are never reconfigured — no downtime),
registers the `kata-qemu` RuntimeClass, taints the node(s), and patches Fluent Bit.

> **Alternative install (Helm):** kata-deploy also ships an OCI Helm chart
> (`oci://ghcr.io/kata-containers/kata-deploy-charts/kata-deploy`), used by the
> [EKS bare-metal + Kata + OpenChoreo write-up](https://ketharan.medium.com/how-to-set-up-an-eks-bare-metal-cluster-with-kata-containers-for-vm-isolated-workloads-19793e62274b).
> `install-kata.sh` uses the raw manifest instead because it lets us reliably inject the
> nodeSelector/toleration that scope the install to the dedicated node. On EKS, Kata needs a
> bare-metal **`*.metal`** instance (VT-x/AMD-V); standard EC2 instances won't work.

---

## 7. Differences from gVisor (quick reference)

| | gVisor | Kata |
|---|---|---|
| Isolation | userspace kernel (`runsc`), syscall interception | full VM (QEMU/KVM), dedicated guest kernel |
| Host requirement | none special (runs in Colima) | **nested virtualization (/dev/kvm)** |
| Install size | one `runsc` binary | full stack (qemu + kernel + initrd + virtiofsd) |
| Production install | `install-gvisor.sh` (per node, edits containerd) | `install-kata.sh` (kata-deploy DaemonSet) |
| RuntimeClass | `gvisor` (handler `runsc`) | `kata-qemu` (handler `kata-qemu`) |
| Networking | runsc netstack; may need `GVISOR_NETWORK_HOST` | normal pod networking (VM bridged into the pod netns) |
| `kubectl port-forward` | unsupported (use the Service/gateway) | also avoid; use the Service/gateway path |
| Metrics granularity | partial under runsc (cgroup caveat) | per-VM; container-granular cgroup metrics also partial |

The cross-node observability/try-it data paths and their failure modes are **identical** to
gVisor — see [gvisor-isolation-tier.md §6](gvisor-isolation-tier.md) (logs via Fluent Bit
DaemonSet; traces/metrics/try-it via the data-plane gateway). The decisive cross-node test
there applies verbatim; just substitute `runtimeClassName: kata-qemu`.

---

## 8. Troubleshooting

### Pod stuck in `ContainerCreating` / `CrashLoopBackOff`
Almost always **no nested virtualization**. Confirm on the Kata node:
```bash
docker exec k3d-kata-0 ls -l /dev/kvm          # dev/k3d
ls -l /dev/kvm; cat /sys/module/kvm_intel/parameters/nested   # production node
kubectl describe pod <pod> -n <ns>             # look for kvm / RuntimeClass errors
```
No `/dev/kvm` → move to an Intel-N2 / bare-metal host with nested virt enabled.

### `no handler found` for `kata-qemu`
The RuntimeClass exists but containerd has no `kata-qemu` runtime (install didn't complete or
the node didn't reload containerd):
```bash
kubectl get runtimeclass kata-qemu
# dev/k3d: confirm the runtime is in the node's containerd config, then restart the node
docker exec k3d-kata-0 grep -n kata-qemu /var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl
docker restart k3d-kata-0
# production: check kata-deploy finished
kubectl -n kube-system rollout status daemonset/kata-deploy
kubectl -n kube-system logs -l name=kata-deploy
```

### Verify isolation is real (different kernel = VM)
```bash
POD=<agent pod>; NS=<ns>
kubectl get pod $POD -n $NS -o jsonpath='{.spec.runtimeClassName}'  # kata-qemu
kubectl exec $POD -n $NS -- uname -r        # differs from the node's `uname -r`
kubectl exec $POD -n $NS -- cat /proc/cpuinfo | grep hypervisor   # hypervisor flag present
```
Same kernel as the node → the pod is NOT under Kata (RuntimeClass not applied / fell back to runc).

### Pod runs but no logs / metrics / traces / try-it
Same as gVisor — this is cross-node networking or the first-deploy API-publish gap, **not** Kata.
Work the runbook in [gvisor-isolation-tier.md §8](gvisor-isolation-tier.md) with
`runtimeClassName: kata-qemu`.

---

## 9. Still open / caveats

- **k3d + Kata** is the least-trodden path (no systemd, hand-rolled static install). The
  `setup-kata-node.sh` mechanism mirrors the working gVisor one, but expect to iterate on a real
  KVM VM — the sanity check at the end of the script (pod kernel ≠ node kernel) tells you if it worked.
- **Nested-virt performance** — VM boot adds startup latency vs. runc/gVisor; warm pools help.
- **API-publish on first deploy (chat-404)** — pre-existing, affects all tiers; see the gVisor doc §9.
- **Sandbox Router** — upstream recommends the Sandbox Router (X-Sandbox-ID) for direct sandbox
  access under Kata since port-forward is incompatible; agents here are reached via the
  Service/gateway path anyway, so this doesn't affect normal agent traffic.
