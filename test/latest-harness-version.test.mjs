import assert from "node:assert/strict";
import test from "node:test";

import { resolveHarnessVersion } from "../core.mjs";

const configurations = [
  { harnessFamily: "pi-agent-ide", harnessVersion: "0.5.0" },
  { harnessFamily: "pi-agent-ide", harnessVersion: "0.5.1" },
  { harnessFamily: "other", harnessVersion: "9.0.0" },
];

test("latest harness links open the newest accepted version", () => {
  assert.equal(resolveHarnessVersion(configurations, "pi-agent-ide", "latest"), "0.5.1");
});

test("exact harness versions stay exact", () => {
  assert.equal(resolveHarnessVersion(configurations, "pi-agent-ide", "0.5.0"), "0.5.0");
});
