import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";

describe("init.mjs", () => {
  it("exports initializePlugin as a function", async () => {
    const { initializePlugin } = await import("./init.mjs");
    assert.equal(typeof initializePlugin, "function");
  });

  it("exports installAgentPlugin as a function", async () => {
    const { installAgentPlugin } = await import("./init.mjs");
    assert.equal(typeof installAgentPlugin, "function");
  });

  it("installAgentPlugin rejects unsupported agents", async () => {
    const { installAgentPlugin } = await import("./init.mjs");
    await assert.rejects(
      () => installAgentPlugin({ targetRoot: "/tmp", agent: "unknown-agent" }),
      /Unsupported agent/,
    );
  });

  it("exports DEFAULT_WORKSPACE_DIRECTORIES containing the standard directories", async () => {
    const { DEFAULT_WORKSPACE_DIRECTORIES } = await import("./init.mjs");
    assert.deepEqual(DEFAULT_WORKSPACE_DIRECTORIES, [
      "workspace/.context",
      "workspace/.discovery",
      "workspace/.analysis",
      "workspace/.knowledge",
      "workspace/src",
    ]);
  });

  it("initializeWorkspaceDirectories creates all standard workspace directories", async () => {
    const { initializeWorkspaceDirectories, DEFAULT_WORKSPACE_DIRECTORIES } = await import("./init.mjs");
    const tempDir = mkdtempSync(join(tmpdir(), "smith-workspace-test-"));
    try {
      await initializeWorkspaceDirectories(tempDir);
      for (const dir of DEFAULT_WORKSPACE_DIRECTORIES) {
        assert.equal(existsSync(join(tempDir, dir)), true);
      }
      // Idempotent: running again succeeds without error
      await initializeWorkspaceDirectories(tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("initializeWorkspaceDirectories refuses symlinks in installation path", async () => {
    const { initializeWorkspaceDirectories } = await import("./init.mjs");
    const tempDir = mkdtempSync(join(tmpdir(), "smith-symlink-test-"));
    const outside = mkdtempSync(join(tmpdir(), "smith-symlink-outside-"));
    try {
      symlinkSync(outside, join(tempDir, "workspace"));
      await assert.rejects(
        () => initializeWorkspaceDirectories(tempDir),
        /Refusing unexpected symlink/,
      );
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
