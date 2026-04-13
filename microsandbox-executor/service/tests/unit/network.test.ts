import test from "node:test";
import assert from "node:assert/strict";

import { buildNetworkConfig } from "../../src/policy/network.js";

test("buildNetworkConfig returns no-network preset", () => {
  const config = buildNetworkConfig("none", []);
  assert.equal(config.policy, "none");
});

test("buildNetworkConfig creates explicit allowlist rules", () => {
  const config = buildNetworkConfig("allowlist", ["api.openai.com"]);

  assert.equal(config.defaultAction, "deny");
  assert.equal(config.rules?.some((rule) => rule.destination === "api.openai.com" && rule.port === "443"), true);
  assert.equal(config.rules?.some((rule) => rule.destination === "*" && rule.port === "53"), true);
});
