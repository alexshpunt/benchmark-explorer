import assert from "node:assert/strict";
import test from "node:test";

import { modelRouteIdentity, modelRouteLabel } from "../core.mjs";

test("model routes keep the provider in identity and visible label", () => {
  const xiaomi = { modelFamily: "xiaomi/mimo-v2.5", provider: "xiaomi" };
  const opencode = { modelFamily: "mimo-v2.5", provider: "opencode-go" };

  assert.equal(modelRouteIdentity(xiaomi), "mimo-v2.5\txiaomi\tunspecified");
  assert.equal(modelRouteIdentity(opencode), "mimo-v2.5\topencode-go\tunspecified");
  assert.equal(modelRouteLabel(xiaomi), "mimo-v2.5 · xiaomi · unspecified");
  assert.equal(modelRouteLabel(opencode), "mimo-v2.5 · opencode-go · unspecified");
});

test("model routes expose an unknown provider instead of merging it silently", () => {
  const row = { modelFamily: "model" };

  assert.equal(modelRouteIdentity(row), "model\tunknown\tunspecified");
  assert.equal(modelRouteLabel(row), "model · unknown · unspecified");
});
