import assert from "node:assert/strict";
import test from "node:test";

import { modelLabel, modelRouteIdentity, modelRouteLabel, modelRouteLabelFromIdentity } from "../core.mjs";

test("model routes use provider / model · reasoning without repeating a provider prefix", () => {
  const xiaomi = { modelFamily: "xiaomi/mimo-v2.5", provider: "xiaomi" };
  const opencode = { modelFamily: "mimo-v2.5", provider: "opencode-go", thinking: "high" };

  assert.equal(modelRouteIdentity(xiaomi), "mimo-v2.5\txiaomi\tunspecified");
  assert.equal(modelRouteIdentity(opencode), "mimo-v2.5\topencode-go\thigh");
  assert.equal(modelRouteLabel(xiaomi), "xiaomi / mimo-v2.5 · unspecified");
  assert.equal(modelRouteLabel(opencode), "opencode-go / mimo-v2.5 · high");
  assert.equal(modelLabel(opencode), "mimo-v2.5 · high");
  assert.equal(modelRouteLabelFromIdentity(modelRouteIdentity(opencode)), modelRouteLabel(opencode));
  assert.equal(modelRouteLabelFromIdentity("mimo-v2.5"), "mimo-v2.5");
  assert.equal(modelRouteLabelFromIdentity("model\tp"), "p / model · unspecified");
});

test("missing provider and reasoning stay explicit, while off is recorded data", () => {
  const row = { modelFamily: "model" };
  assert.equal(modelRouteIdentity(row), "model\tunknown\tunspecified");
  assert.equal(modelRouteLabel(row), "unknown / model · unspecified");
  assert.equal(modelRouteLabel({ ...row, thinking: "off" }), "unknown / model · off");
  assert.equal(modelRouteLabel({ ...row, thinking: "" }), "unknown / model · unspecified");
});

test("profile labels fall back to the model ID without inventing reasoning", () => {
  assert.equal(modelRouteLabel({ modelId: "p/m", provider: "p" }), "p / m · unspecified");
  assert.equal(modelRouteLabel({}), "unknown / Model · unspecified");
});
