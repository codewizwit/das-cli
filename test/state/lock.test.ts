import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCK_BUSY, withLock } from "../../src/state/lock.js";

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("withLock", () => {
  let tempDir: string;
  let lockPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "das-lock-test-"));
    lockPath = join(tempDir, "das.lock");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("acquires when no lockfile exists, runs the action, and releases the lock", async () => {
    const result = await withLock(lockPath, () => Promise.resolve("done"));

    expect(result).toBe("done");
    await expect(fileExists(lockPath)).resolves.toBe(false);
  });

  it("releases the lock even when the action throws, and propagates the error", async () => {
    const actionError = new Error("action failed");

    await expect(
      withLock(lockPath, () => Promise.reject(actionError)),
    ).rejects.toThrow("action failed");
    await expect(fileExists(lockPath)).resolves.toBe(false);
  });

  it("returns LOCK_BUSY without running the action when a fresh lockfile exists", async () => {
    const now = (): number => 1_000_000;
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 999_999, timestamp: now() - 1_000 }),
      "utf-8",
    );
    const action = vi.fn(() => Promise.resolve("should not run"));

    const result = await withLock(lockPath, action, { now });

    expect(result).toBe(LOCK_BUSY);
    expect(action).not.toHaveBeenCalled();
    await expect(readFile(lockPath, "utf-8")).resolves.toContain("999999");
  });

  it("breaks a stale lockfile and acquires it, running the action", async () => {
    const now = (): number => 2_000_000;
    await writeFile(
      lockPath,
      JSON.stringify({ pid: 999_999, timestamp: now() - 700_000 }),
      "utf-8",
    );

    const result = await withLock(lockPath, () => Promise.resolve("acquired"), {
      now,
      staleMs: 600_000,
    });

    expect(result).toBe("acquired");
    await expect(fileExists(lockPath)).resolves.toBe(false);
  });

  it("treats a corrupt, non-JSON lockfile as stale and acquires it", async () => {
    await writeFile(lockPath, "not json{", "utf-8");

    const result = await withLock(lockPath, () => Promise.resolve("acquired"));

    expect(result).toBe("acquired");
    await expect(fileExists(lockPath)).resolves.toBe(false);
  });

  it("serializes two concurrent calls on the same path: exactly one runs the action", async () => {
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const actionCalls: string[] = [];

    const firstPromise = withLock(lockPath, async () => {
      actionCalls.push("first");
      await gate;
      return "first-result";
    });

    await vi.waitFor(async () => {
      await expect(fileExists(lockPath)).resolves.toBe(true);
    });

    const secondResult = await withLock(lockPath, () => {
      actionCalls.push("second");
      return Promise.resolve("second-result");
    });

    expect(secondResult).toBe(LOCK_BUSY);
    expect(actionCalls).toEqual(["first"]);

    releaseGate();
    await expect(firstPromise).resolves.toBe("first-result");
    await expect(fileExists(lockPath)).resolves.toBe(false);
  });

  it("writes a payload containing the current pid and the injected now() timestamp", async () => {
    const now = (): number => 123_456_789;
    let capturedPayload: unknown;

    await withLock(
      lockPath,
      async () => {
        capturedPayload = JSON.parse(await readFile(lockPath, "utf-8"));
        return "done";
      },
      { now },
    );

    expect(capturedPayload).toEqual({
      pid: process.pid,
      timestamp: 123_456_789,
    });
  });
});
