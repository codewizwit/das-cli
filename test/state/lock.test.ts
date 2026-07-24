import {
  access,
  mkdtemp,
  readFile,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";
import { LOCK_BUSY, withLock } from "../../src/state/lock.js";

const { claimRenameHooks } = vi.hoisted(() => ({
  claimRenameHooks: {
    before: undefined as (() => Promise<void>) | undefined,
    after: undefined as (() => Promise<void>) | undefined,
  },
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
        const beforeHook = claimRenameHooks.before;
        claimRenameHooks.before = undefined;
        if (beforeHook) {
          await beforeHook();
        }

        await actual.rename(source, destination);

        const afterHook = claimRenameHooks.after;
        claimRenameHooks.after = undefined;
        if (afterHook) {
          await afterHook();
        }
      },
    ),
  };
});

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

  it("does not break a recently-created empty lockfile and returns LOCK_BUSY, without deleting it", async () => {
    await writeFile(lockPath, "", "utf-8");
    const action = vi.fn(() => Promise.resolve("should not run"));

    const result = await withLock(lockPath, action, { staleMs: 600_000 });

    expect(result).toBe(LOCK_BUSY);
    expect(action).not.toHaveBeenCalled();
    await expect(fileExists(lockPath)).resolves.toBe(true);
  });

  it("breaks an old, corrupt lockfile once its mtime exceeds staleMs, and acquires it", async () => {
    await writeFile(lockPath, "not json{", "utf-8");
    const oldMtime = new Date(Date.now() - 700_000);
    await utimes(lockPath, oldMtime, oldMtime);

    const result = await withLock(lockPath, () => Promise.resolve("acquired"), {
      staleMs: 600_000,
    });

    expect(result).toBe("acquired");
    await expect(fileExists(lockPath)).resolves.toBe(false);
  });

  // Covers the fully-written-lock case (a live holder whose payload was already flushed to disk).
  // The mid-write race where the file exists but is still empty is covered by the
  // "recently-created empty lockfile" test above.
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

  it("resolves a race over one genuinely-stale lockfile to exactly one winner, every trial", async () => {
    const staleTrialCount = 25;
    const concurrentCallerCount = 8;

    for (let trial = 0; trial < staleTrialCount; trial++) {
      const trialLockPath = join(tempDir, `race-${String(trial)}.lock`);
      await writeFile(
        trialLockPath,
        JSON.stringify({ pid: 999_999, timestamp: 0 }),
        "utf-8",
      );

      const actionCalls: number[] = [];
      const results = await Promise.all(
        Array.from({ length: concurrentCallerCount }, (_, callerIndex) =>
          withLock(
            trialLockPath,
            () => {
              actionCalls.push(callerIndex);
              return Promise.resolve(callerIndex);
            },
            { staleMs: 0 },
          ),
        ),
      );

      expect(actionCalls).toHaveLength(1);
      const winners = results.filter((result) => result !== LOCK_BUSY);
      expect(winners).toHaveLength(1);

      const residualLockIsStale = await withLock(
        trialLockPath,
        () => Promise.resolve("cleanup"),
        { staleMs: 0 },
      );
      expect(residualLockIsStale).toBe("cleanup");
    }
  });

  it("never clobbers a lock a fresh caller acquired while restoring a rejected claim", async () => {
    const originalStaleContent = JSON.stringify({
      pid: 111_111,
      timestamp: 0,
    });
    const liveHolderAContent = JSON.stringify({
      pid: 222_222,
      timestamp: 5_000_000,
    });
    await writeFile(lockPath, originalStaleContent, "utf-8");

    let releaseCallerCGate!: () => void;
    const callerCGate = new Promise<void>((resolve) => {
      releaseCallerCGate = resolve;
    });
    let callerCAcquired = false;
    let callerCPromise!: ReturnType<typeof withLock<string>>;

    claimRenameHooks.before = async () => {
      await writeFile(lockPath, liveHolderAContent, "utf-8");
    };
    claimRenameHooks.after = async () => {
      callerCPromise = withLock(
        lockPath,
        async () => {
          callerCAcquired = true;
          await callerCGate;
          return "caller-c-result";
        },
        { staleMs: 0 },
      );
      await vi.waitFor(() => {
        if (!callerCAcquired) {
          throw new Error("caller C has not acquired the lock yet");
        }
      });
    };

    const stragglerResult = await withLock(
      lockPath,
      () => Promise.resolve("straggler-should-not-run"),
      { staleMs: 0 },
    );

    expect(stragglerResult).toBe(LOCK_BUSY);
    expect(callerCAcquired).toBe(true);

    const lockContentAfterRestoreAttempt = await readFile(lockPath, "utf-8");
    expect(lockContentAfterRestoreAttempt).not.toBe(liveHolderAContent);
    expect(JSON.parse(lockContentAfterRestoreAttempt)).toMatchObject({
      pid: process.pid,
    });

    releaseCallerCGate();
    await expect(callerCPromise).resolves.toBe("caller-c-result");
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
