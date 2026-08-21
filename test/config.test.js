import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("recipient is not embedded in the public default config", () => {
  assert.equal(loadConfig({}).recipient, "");
  assert.equal(loadConfig({ GMAIL_TO: "test@example.invalid" }).recipient, "test@example.invalid");
});
