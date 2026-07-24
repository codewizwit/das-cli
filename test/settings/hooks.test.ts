import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as FsPromises from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SettingsParseError,
  installSessionStartHook,
} from "../../src/settings/hooks.js";

const { renameFailureState } = vi.hoisted(() => ({
  renameFailureState: { throwOnce: false },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    rename: vi.fn(
      async (
        source: Parameters<typeof actual.rename>[0],
        destination: Parameters<typeof actual.rename>[1],
      ) => {
        if (renameFailureState.throwOnce) {
          renameFailureState.throwOnce = false;
          throw new Error("simulated rename failure");
        }
        return actual.rename(source, destination);
      },
    ),
  };
});

interface WrittenSettings {
  env?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
  hooks: {
    PreToolUse?: unknown;
    SessionStart: unknown[];
  };
}

function readJson(raw: string): WrittenSettings {
  return JSON.parse(raw) as WrittenSettings;
}

const dasHookEntry = {
  matcher: "startup",
  hooks: [{ type: "command", command: "das refresh --hook", timeout: 60 }],
};

describe("installSessionStartHook", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "das-hooks-test-"));
    settingsPath = join(tempDir, "settings.json");
    renameFailureState.throwOnce = false;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates the settings file with the DAS SessionStart hook when none exists", async () => {
    const result = await installSessionStartHook(settingsPath);

    expect(result).toBe("installed");
    const written = readJson(await readFile(settingsPath, "utf-8"));
    expect(written).toEqual({
      hooks: {
        SessionStart: [dasHookEntry],
      },
    });
  });

  it("preserves unrelated top-level keys, other hook events, and an existing non-DAS SessionStart entry", async () => {
    const existingEntry = {
      matcher: "resume",
      hooks: [{ type: "command", command: "some-other-tool --check" }],
    };
    const existingSettings = {
      env: { FOO: "bar" },
      permissions: { allow: ["Bash(ls:*)"] },
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "guard.sh" }],
          },
        ],
        SessionStart: [existingEntry],
      },
    };
    await writeFile(
      settingsPath,
      JSON.stringify(existingSettings, null, 2),
      "utf-8",
    );

    const result = await installSessionStartHook(settingsPath);

    expect(result).toBe("installed");
    const written = readJson(await readFile(settingsPath, "utf-8"));
    expect(written.env).toEqual(existingSettings.env);
    expect(written.permissions).toEqual(existingSettings.permissions);
    expect(written.hooks.PreToolUse).toEqual(existingSettings.hooks.PreToolUse);
    expect(written.hooks.SessionStart).toEqual([existingEntry, dasHookEntry]);
  });

  it("appends the DAS entry alongside other SessionStart matchers, preserving them", async () => {
    const otherMatcherEntry = {
      matcher: "clear",
      hooks: [{ type: "command", command: "cleanup.sh" }],
    };
    await writeFile(
      settingsPath,
      JSON.stringify({ hooks: { SessionStart: [otherMatcherEntry] } }, null, 2),
      "utf-8",
    );

    const result = await installSessionStartHook(settingsPath);

    expect(result).toBe("installed");
    const written = readJson(await readFile(settingsPath, "utf-8"));
    expect(written.hooks.SessionStart).toEqual([
      otherMatcherEntry,
      dasHookEntry,
    ]);
  });

  it("returns already-present and leaves the file byte-for-byte unchanged when the DAS hook already exists", async () => {
    const existingSettings = {
      hooks: {
        SessionStart: [dasHookEntry],
      },
    };
    const serialized = `${JSON.stringify(existingSettings, null, 2)}\n`;
    await writeFile(settingsPath, serialized, "utf-8");
    const before = await readFile(settingsPath, "utf-8");

    const result = await installSessionStartHook(settingsPath);

    expect(result).toBe("already-present");
    const after = await readFile(settingsPath, "utf-8");
    expect(after).toBe(before);
  });

  it("throws SettingsParseError and leaves the file untouched when existing settings.json is malformed", async () => {
    const malformed = "{ this is not valid json";
    await writeFile(settingsPath, malformed, "utf-8");

    await expect(installSessionStartHook(settingsPath)).rejects.toThrow(
      SettingsParseError,
    );
    const after = await readFile(settingsPath, "utf-8");
    expect(after).toBe(malformed);
  });

  it("writes atomically: no temp file remains and settingsPath is valid JSON afterward", async () => {
    await installSessionStartHook(settingsPath);

    const entries = await readdir(tempDir);
    expect(entries).toEqual(["settings.json"]);
    const content = await readFile(settingsPath, "utf-8");
    expect(() => {
      JSON.parse(content);
    }).not.toThrow();
  });

  it("cleans up the temp file and leaves settingsPath untouched when rename fails after a successful write and re-parse", async () => {
    const existingSettings = { env: { FOO: "bar" } };
    const serialized = `${JSON.stringify(existingSettings, null, 2)}\n`;
    await writeFile(settingsPath, serialized, "utf-8");
    const before = await readFile(settingsPath, "utf-8");

    renameFailureState.throwOnce = true;

    await expect(installSessionStartHook(settingsPath)).rejects.toThrow(
      "simulated rename failure",
    );

    const after = await readFile(settingsPath, "utf-8");
    expect(after).toBe(before);
    const entries = await readdir(tempDir);
    expect(entries).toEqual(["settings.json"]);
  });

  it("detects the DAS hook when it is not the first SessionStart entry and leaves the file unchanged", async () => {
    const otherEntry = {
      matcher: "resume",
      hooks: [{ type: "command", command: "some-other-tool --check" }],
    };
    const existingSettings = {
      hooks: {
        SessionStart: [otherEntry, dasHookEntry],
      },
    };
    const serialized = `${JSON.stringify(existingSettings, null, 2)}\n`;
    await writeFile(settingsPath, serialized, "utf-8");
    const before = await readFile(settingsPath, "utf-8");

    const result = await installSessionStartHook(settingsPath);

    expect(result).toBe("already-present");
    const after = await readFile(settingsPath, "utf-8");
    expect(after).toBe(before);
  });

  it("is idempotent across two real sequential calls: second call is a no-op", async () => {
    const firstResult = await installSessionStartHook(settingsPath);
    expect(firstResult).toBe("installed");
    const afterFirst = await readFile(settingsPath, "utf-8");

    const secondResult = await installSessionStartHook(settingsPath);
    expect(secondResult).toBe("already-present");

    const afterSecond = await readFile(settingsPath, "utf-8");
    expect(afterSecond).toBe(afterFirst);
    const written = readJson(afterSecond);
    expect(written.hooks.SessionStart).toHaveLength(1);
  });
});
