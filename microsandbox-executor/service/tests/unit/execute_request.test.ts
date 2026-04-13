import test from "node:test";
import assert from "node:assert/strict";

import { executeBashRequestSchema, executeRequestSchema } from "../../src/jobs/models.js";

test("executeRequestSchema accepts session-relative file paths", () => {
  const parsed = executeRequestSchema.parse({
    session_id: "sess_123",
    file_paths: ["inputs/example.txt", "nested/data.csv"],
    code: "print('hello')"
  });

  assert.deepEqual(parsed.filePaths, ["inputs/example.txt", "nested/data.csv"]);
  assert.equal(parsed.pythonProfile, "default");
});

test("executeRequestSchema allows omitting file paths to stage the whole session", () => {
  const parsed = executeRequestSchema.parse({
    session_id: "sess_123",
    code: "print('hello')"
  });

  assert.equal(parsed.filePaths, undefined);
});

test("executeRequestSchema rejects unsafe file paths", () => {
  const result = executeRequestSchema.safeParse({
    session_id: "sess_123",
    file_paths: ["../secret.txt"],
    code: "print('hello')"
  });

  assert.equal(result.success, false);
});

test("executeRequestSchema accepts data-science python profile", () => {
  const parsed = executeRequestSchema.parse({
    session_id: "sess_123",
    file_paths: ["inputs/example.txt"],
    python_profile: "data-science",
    code: "import pandas as pd"
  });

  assert.equal(parsed.pythonProfile, "data-science");
});

test("executeBashRequestSchema accepts shell scripts", () => {
  const parsed = executeBashRequestSchema.parse({
    session_id: "sess_123",
    script: "echo hello > output.txt"
  });

  assert.equal(parsed.entrypoint, "main.sh");
  assert.equal(parsed.kind, "bash");
});
