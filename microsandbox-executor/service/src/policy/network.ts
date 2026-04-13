import type { NetworkConfig, PolicyRule } from "microsandbox";

export function buildNetworkConfig(
  mode: "none" | "allowlist" | "public",
  allowedHosts: string[]
): NetworkConfig {
  if (mode === "none") {
    return { policy: "none" };
  }

  if (mode === "public") {
    return { policy: "public-only" };
  }

  const hosts = [...new Set(allowedHosts.map(normalizeHost))];

  if (hosts.length === 0) {
    throw new Error("allowed_hosts must contain at least one host when network_mode is allowlist");
  }

  const rules: PolicyRule[] = [];

  for (const host of hosts) {
    rules.push({ action: "allow", direction: "outbound", destination: host, protocol: "tcp", port: "80" });
    rules.push({ action: "allow", direction: "outbound", destination: host, protocol: "tcp", port: "443" });
  }

  rules.push({ action: "allow", direction: "outbound", destination: "*", protocol: "udp", port: "53" });
  rules.push({ action: "allow", direction: "outbound", destination: "*", protocol: "tcp", port: "53" });
  rules.push({ action: "deny", direction: "outbound", destination: "metadata" });
  rules.push({ action: "deny", direction: "outbound", destination: "private" });

  return {
    rules,
    defaultAction: "deny",
    dnsRebindProtection: true
  };
}

function normalizeHost(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("allowed_hosts cannot contain empty values");
  }

  return normalized;
}
