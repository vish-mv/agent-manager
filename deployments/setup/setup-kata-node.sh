#!/bin/bash

# Adds a single Kata Containers node to the EXISTING k3d cluster and registers a
# `kata-qemu` RuntimeClass, so agents deployed to a Kata-tier environment boot in a
# lightweight VM with their own guest kernel instead of the default runc (shared kernel).
#
# Why this is safe to run on a live cluster: installing Kata reconfigures containerd and
# restarts the node. We do that ONLY on the new, empty node we just created — the server
# node and every running (runc) agent are never touched, so there is no downtime.
#
# IMPORTANT — nested virtualization required:
#   Kata-qemu boots a real VM via QEMU/KVM, so the HOST running these k3d containers MUST
#   expose /dev/kvm (nested virtualization enabled). This works on a bare-metal Linux host
#   or a nested-virt-capable cloud VM (e.g. GCP Intel N2 with --enable-nested-virtualization).
#   It does NOT work on macOS/Colima — Kata pods would hang in ContainerCreating there.
#   The script checks /dev/kvm in the node container and aborts with guidance if missing.
#
# Why hand-rolled here (vs. upstream kata-deploy):
#   kata-deploy assumes a systemd-managed containerd and restarts it via systemctl. k3d nodes
#   run k3s as PID 1 with no systemd, so we instead install the Kata static stack into the node
#   and force a reload with `docker restart` — the same proven mechanism setup-gvisor-node.sh
#   uses for runsc. On real Linux nodes use install-kata.sh (kata-deploy) instead.
#
# Prerequisites:
#   - Main cluster running (make setup)
#   - Host with /dev/kvm (nested virtualization)
#   - curl, xz, docker, kubectl, k3d available on this machine
#
# Idempotent: re-running skips node creation / Kata install / config when already done.
#
# Usage:  make setup-kata      (or:  ./setup-kata-node.sh)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
source "$SCRIPT_DIR/env.sh"
source "$SCRIPT_DIR/utils.sh"

echo "=== Adding Kata Containers isolation node to cluster '${CLUSTER_NAME}' ==="

# --- Preconditions ---
if ! kubectl cluster-info --context "$CLUSTER_CONTEXT" &>/dev/null; then
    echo "❌ k3d cluster '$CLUSTER_CONTEXT' is not running. Run: make setup"
    exit 1
fi
kubectl config use-context "$CLUSTER_CONTEXT" >/dev/null

if ! command -v xz &>/dev/null; then
    echo "❌ 'xz' is required to decompress the Kata static release. Install it:"
    echo "     Debian/Ubuntu: sudo apt-get install -y xz-utils   |   macOS: brew install xz"
    exit 1
fi

SERVER_CONTAINER="k3d-${CLUSTER_NAME}-server-0"

# --- Raise inotify limits on the host kernel BEFORE creating the node ---
# k3d nodes share the host kernel; after a full `make setup` the default
# fs.inotify.max_user_instances (128) is exhausted, so a fresh node's containerd CRI
# plugin fails ("too many open files") and `k3d node create --wait` hangs. Bump via the
# privileged server container (propagates to the shared kernel). Idempotent.
if docker ps --filter "name=${SERVER_CONTAINER}" --format '{{.Names}}' | grep -q "${SERVER_CONTAINER}"; then
    echo "⚙️  Raising inotify limits on the host kernel (needed by containerd CRI)..."
    docker exec "${SERVER_CONTAINER}" sysctl -w fs.inotify.max_user_instances=512 >/dev/null 2>&1 || true
    docker exec "${SERVER_CONTAINER}" sysctl -w fs.inotify.max_user_watches=524288 >/dev/null 2>&1 || true
fi

# --- 1. Create the Kata agent node (skip if present) ---
if docker ps -a --filter "name=k3d-${KATA_NODE_NAME}-" --format '{{.Names}}' 2>/dev/null | grep -q "k3d-${KATA_NODE_NAME}-"; then
    echo "✅ Kata node already exists — skipping creation"
else
    # Clear any stale registration from a previously deleted node of the same name
    # (k3s keeps the node-password secret + Node object; a recreated node is then
    # rejected with "Node password rejected, duplicate hostname" and create hangs).
    echo "🧹 Clearing any stale registration for k3d-${KATA_NODE_NAME}-0..."
    kubectl delete secret "k3d-${KATA_NODE_NAME}-0.node-password.k3s" -n kube-system --ignore-not-found >/dev/null 2>&1 || true
    kubectl delete node "k3d-${KATA_NODE_NAME}-0" --ignore-not-found >/dev/null 2>&1 || true

    echo "🚀 Creating Kata agent node in cluster '${CLUSTER_NAME}'..."
    k3d node create "${KATA_NODE_NAME}" --cluster "${CLUSTER_NAME}" --role agent --wait
fi

NODE_CONTAINER="$(docker ps --filter "name=k3d-${KATA_NODE_NAME}-" --format '{{.Names}}' | head -1)"
if [ -z "$NODE_CONTAINER" ]; then
    echo "❌ Could not find the Kata node container (k3d-${KATA_NODE_NAME}-*)"
    exit 1
fi
NODE_NAME="$NODE_CONTAINER" # k3d's k8s node name == container name
echo "   Node: ${NODE_NAME}"

# --- 1b. Verify nested virtualization (/dev/kvm) is available in the node ---
# Without KVM, kata-qemu cannot boot a VM and agent pods get stuck in ContainerCreating.
# k3d node containers run privileged, so /dev/kvm is visible IFF the host exposes it.
if docker exec "${NODE_CONTAINER}" test -e /dev/kvm 2>/dev/null; then
    echo "   ✅ /dev/kvm present in ${NODE_NAME} — nested virtualization available"
else
    echo "❌ /dev/kvm is NOT available in ${NODE_NAME}."
    echo "   Kata-qemu requires nested virtualization on the host running these containers."
    echo "   - macOS/Colima: not supported — use a Linux host or a nested-virt cloud VM."
    echo "   - GCP: create the VM with --enable-nested-virtualization on an Intel N2 machine."
    echo "   - Verify on the host:  ls -l /dev/kvm   (and kvm_intel/kvm_amd nested=Y)"
    exit 1
fi

# --- 2. Match the cluster's registry mirror on the new node ---
# So the Kata node can pull agent images from the local workflow-plane registry.
if docker cp "${SERVER_CONTAINER}:/etc/rancher/k3s/registries.yaml" /tmp/k3d-registries.yaml 2>/dev/null; then
    docker exec "${NODE_CONTAINER}" mkdir -p /etc/rancher/k3s
    docker cp /tmp/k3d-registries.yaml "${NODE_CONTAINER}:/etc/rancher/k3s/registries.yaml"
    rm -f /tmp/k3d-registries.yaml
    echo "   ✅ Registry mirror config copied from server node"
fi

# --- 3. Install the Kata static stack into the node (skip if already present) ---
# The static tarball bundles the whole VM stack (qemu + guest kernel + initrd + virtiofsd)
# and extracts to /opt/kata. We decompress on the host (xz) and stream into the node's
# busybox tar (the k3s image has no xz). containerd resolves the shim from the runtime_type
# (io.containerd.kata-qemu.v2 → binary containerd-shim-kata-qemu-v2), so we symlink it.
if docker exec "${NODE_CONTAINER}" test -x /opt/kata/bin/containerd-shim-kata-v2 2>/dev/null; then
    echo "✅ Kata static stack already present on ${NODE_NAME}"
else
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64)        KATA_ARCH="amd64" ;;
        aarch64|arm64) KATA_ARCH="arm64" ;; # macOS reports arm64; kata uses arm64
        s390x)         KATA_ARCH="s390x" ;;
        *) echo "❌ Unsupported architecture: $ARCH"; exit 1 ;;
    esac

    TARBALL="kata-static-${KATA_VERSION}-${KATA_ARCH}.tar.xz"
    URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/${TARBALL}"
    echo "📥 Downloading ${TARBALL} (this is large — full VM stack)..."
    curl -fSL --retry 3 "$URL" -o "/tmp/${TARBALL}"

    echo "📦 Installing Kata into ${NODE_NAME} (decompress on host → stream into node tar)..."
    # Tarball entries are ./opt/kata/... → extracting at / yields /opt/kata.
    xz -dc "/tmp/${TARBALL}" | docker exec -i "${NODE_CONTAINER}" tar -xf - -C /
    rm -f "/tmp/${TARBALL}"
    # Fresh k3s node images have no /usr/local/bin — create it before linking the shim.
    docker exec "${NODE_CONTAINER}" mkdir -p /usr/local/bin
    docker exec "${NODE_CONTAINER}" ln -sf /opt/kata/bin/containerd-shim-kata-v2 \
        /usr/local/bin/containerd-shim-kata-qemu-v2
    echo "   ✅ Kata ${KATA_VERSION} installed at /opt/kata"
fi

# --- 3b. Configure containerd's kata-qemu runtime (IDEMPOTENT) ---
# The '{{ template "base" . }}' prefix is REQUIRED so k3s renders its default config
# (CNI + registry mirrors) first; without it CNI fails (pods NotReady). We point the
# runtime at the bundled QEMU configuration so it uses the QEMU hypervisor.
echo "⚙️  Ensuring containerd kata-qemu runtime config..."
KATA_CFG_RESULT=$(docker exec "${NODE_CONTAINER}" /bin/sh -c '
    set -e
    mkdir -p /usr/local/bin
    ln -sf /opt/kata/bin/containerd-shim-kata-v2 /usr/local/bin/containerd-shim-kata-qemu-v2
    TMPL=/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl
    mkdir -p "$(dirname "$TMPL")"
    if grep -q "runtimes.kata-qemu" "$TMPL" 2>/dev/null; then
        echo UNCHANGED
    else
        cat > "$TMPL" <<EOT
{{ template "base" . }}

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-qemu]
  runtime_type = "io.containerd.kata-qemu.v2"
  privileged_without_host_devices = true
  pod_annotations = ["io.katacontainers.*"]
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata-qemu.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration-qemu.toml"
EOT
        echo CHANGED
    fi
')

if echo "$KATA_CFG_RESULT" | grep -q CHANGED; then
    # docker restart (not SIGHUP): k3s reads the containerd config only at startup.
    echo "🔄 containerd kata-qemu config changed — restarting ${NODE_NAME} to apply..."
    docker restart "${NODE_CONTAINER}" >/dev/null
else
    echo "✅ containerd kata-qemu config already correct — no restart needed"
fi

echo "⏳ Waiting for the Kata node to be Ready..."
kubectl wait --context "$CLUSTER_CONTEXT" --for=condition=Ready "node/${NODE_NAME}" --timeout=180s

# Generate a machine-id for Fluent Bit (the manually-named Kata node isn't covered by
# the shared generate_machine_ids helper, which only handles k3d-${CLUSTER_NAME}-* nodes).
if ! docker exec "${NODE_CONTAINER}" test -s /etc/machine-id 2>/dev/null; then
    docker exec "${NODE_CONTAINER}" sh -c \
        "cat /proc/sys/kernel/random/uuid | tr -d '-' > /etc/machine-id"
    echo "   ✅ machine-id generated for ${NODE_NAME}"
fi

# --- Ensure host.k3d.internal resolves on the new node (lost on container restart) ---
HOST_K3D_IP=$(docker exec "${SERVER_CONTAINER}" /bin/sh -c \
    "grep 'host.k3d.internal' /etc/hosts | awk '{print \$1}' | head -1" 2>/dev/null || true)
if [ -n "$HOST_K3D_IP" ]; then
    if ! docker exec "${NODE_CONTAINER}" grep -q "host.k3d.internal" /etc/hosts 2>/dev/null; then
        docker exec "${NODE_CONTAINER}" /bin/sh -c \
            "echo '${HOST_K3D_IP} host.k3d.internal' >> /etc/hosts"
        echo "   ✅ host.k3d.internal (${HOST_K3D_IP}) added to ${NODE_NAME} /etc/hosts"
    else
        echo "   ✅ host.k3d.internal already present in ${NODE_NAME} /etc/hosts"
    fi
fi

# --- 4. RuntimeClass with scheduling ---
# `scheduling` makes the RuntimeClass admission controller auto-inject the nodeSelector and
# toleration into any pod that sets runtimeClassName: kata-qemu, so the agent-api
# ComponentType only has to set runtimeClassName.
echo "🧩 Creating/updating the '${KATA_RUNTIME_CLASS}' RuntimeClass..."
kubectl apply --context "$CLUSTER_CONTEXT" -f "$SCRIPT_DIR/../k8s/kata-runtimeclass.yaml"

# --- 5. Label + taint the node ---
# Label: matches the RuntimeClass nodeSelector. Taint: keeps non-Kata pods off this node
# (Kata pods tolerate it via the RuntimeClass scheduling stanza).
echo "🏷️  Labeling and tainting ${NODE_NAME}..."
kubectl label --context "$CLUSTER_CONTEXT" node "${NODE_NAME}" \
    "${KATA_NODE_LABEL_KEY}=${KATA_NODE_LABEL_VALUE}" --overwrite
kubectl taint --context "$CLUSTER_CONTEXT" node "${NODE_NAME}" \
    "${KATA_NODE_LABEL_KEY}=${KATA_NODE_LABEL_VALUE}:NoSchedule" --overwrite

# --- 6. Ensure the Fluent Bit log collector tolerates the Kata taint ---
if kubectl get daemonset fluent-bit -n openchoreo-observability-plane --context "$CLUSTER_CONTEXT" &>/dev/null; then
    echo "🪵 Ensuring Fluent Bit tolerates the Kata taint (so logs are collected here)..."
    kubectl patch daemonset fluent-bit -n openchoreo-observability-plane --context "$CLUSTER_CONTEXT" --type=json \
        -p='[{"op":"add","path":"/spec/template/spec/tolerations","value":[{"operator":"Exists"}]}]' >/dev/null 2>&1 || true
fi

# --- Status + isolation sanity check ---
echo ""
echo "✅ Kata isolation node ready."
kubectl get --context "$CLUSTER_CONTEXT" node "${NODE_NAME}" -o wide
kubectl get --context "$CLUSTER_CONTEXT" runtimeclass "${KATA_RUNTIME_CLASS}"

echo ""
echo "🔍 Isolation sanity check (kata-qemu pod boots its own VM kernel)..."
# Proves Kata is actually virtualizing: the pod's kernel differs from the node's, because
# it runs in a guest VM. If the pod never goes Ready, KVM/containerd config needs attention.
SANITY_POD="kata-isocheck"
kubectl delete pod "$SANITY_POD" --context "$CLUSTER_CONTEXT" --ignore-not-found >/dev/null 2>&1 || true
cat <<EOF | kubectl apply --context "$CLUSTER_CONTEXT" -f - >/dev/null 2>&1 || true
apiVersion: v1
kind: Pod
metadata:
  name: ${SANITY_POD}
spec:
  runtimeClassName: ${KATA_RUNTIME_CLASS}
  restartPolicy: Never
  containers:
    - name: isocheck
      image: busybox:1.36
      command: ["sh","-c","uname -r; echo KATA_DONE; sleep 1"]
EOF
if kubectl wait --context "$CLUSTER_CONTEXT" --for=jsonpath='{.status.phase}'=Succeeded "pod/${SANITY_POD}" --timeout=120s >/dev/null 2>&1 \
    || kubectl wait --context "$CLUSTER_CONTEXT" --for=condition=Ready "pod/${SANITY_POD}" --timeout=120s >/dev/null 2>&1; then
    POD_KERNEL=$(kubectl logs "$SANITY_POD" --context "$CLUSTER_CONTEXT" 2>/dev/null | head -1)
    NODE_KERNEL=$(docker exec "${NODE_CONTAINER}" uname -r 2>/dev/null || echo "?")
    echo "   pod kernel:  ${POD_KERNEL}"
    echo "   node kernel: ${NODE_KERNEL}"
    if [ -n "$POD_KERNEL" ] && [ "$POD_KERNEL" != "$NODE_KERNEL" ]; then
        echo "   ✅ Pod kernel differs from the node — Kata VM isolation is active."
    else
        echo "   ⚠️  Pod kernel matches the node (or empty) — pod may NOT be running under Kata."
        echo "      Check:  kubectl describe pod ${SANITY_POD}   and   deployments/kata-isolation-tier.md"
    fi
else
    echo "   ⚠️  Kata sanity pod did not become Ready (common cause: missing/blocked /dev/kvm)."
    echo "      Inspect:  kubectl describe pod ${SANITY_POD}"
    echo "      See deployments/kata-isolation-tier.md → Troubleshooting."
fi
kubectl delete pod "$SANITY_POD" --context "$CLUSTER_CONTEXT" --ignore-not-found >/dev/null 2>&1 || true

echo ""
echo "Next steps:"
echo "  1. Create a Kata environment (ISOLATION_TIER=kata ... bash ../scripts/add-environment.sh)."
echo "  2. Deploy or promote an agent to that environment."
echo "  3. Verify it landed on the Kata node and runs under kata-qemu:"
echo "       kubectl get pod <pod> -n <ns> -o wide            # NODE == ${NODE_NAME}"
echo "       kubectl get pod <pod> -n <ns> -o jsonpath='{.spec.runtimeClassName}'   # kata-qemu"
