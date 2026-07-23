import { readFile, rm, stat, writeFile } from "node:fs/promises";

/** Sentinel returned by {@link withLock} when the lock is already held by a live holder. */
export const LOCK_BUSY = Symbol("LOCK_BUSY");

/** Type of the {@link LOCK_BUSY} sentinel. */
export type LockBusy = typeof LOCK_BUSY;

/** Options controlling staleness detection and the clock {@link withLock} reads from. */
export interface WithLockOptions {
  /** Age in milliseconds after which an existing lockfile is considered abandoned. Defaults to 600000 (10 minutes). */
  staleMs?: number;
  /** Clock used for both the written timestamp and staleness comparisons. Defaults to `Date.now`. */
  now?: () => number;
}

interface LockPayload {
  pid: number;
  timestamp: number;
}

const DEFAULT_STALE_MS = 600_000;

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseLockPayload(raw: string): LockPayload | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Partial<LockPayload>).pid === "number" &&
    typeof (parsed as Partial<LockPayload>).timestamp === "number"
  ) {
    return parsed as LockPayload;
  }

  return undefined;
}

async function isLockStale(
  lockPath: string,
  staleMs: number,
  now: () => number,
): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(lockPath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }

  const payload = parseLockPayload(raw);
  if (payload) {
    return now() - payload.timestamp >= staleMs;
  }

  return isLockFileAgeStale(lockPath, staleMs, now);
}

async function isLockFileAgeStale(
  lockPath: string,
  staleMs: number,
  now: () => number,
): Promise<boolean> {
  let stats;
  try {
    stats = await stat(lockPath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }

  return now() - stats.mtimeMs >= staleMs;
}

async function tryAcquire(
  lockPath: string,
  now: () => number,
): Promise<boolean> {
  const payload: LockPayload = { pid: process.pid, timestamp: now() };

  try {
    await writeFile(lockPath, JSON.stringify(payload), { flag: "wx" });
  } catch (error) {
    if (isErrnoException(error) && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }

  return true;
}

/**
 * Run `action` while holding an advisory, cross-process lockfile, so concurrent das processes
 * never co-write the same manifest or skill.
 *
 * The lock is acquired with a single exclusive-create (`O_EXCL`) write of `lockPath` containing
 * the holder's payload, which is atomic across processes on the same filesystem: there is no
 * window where the file exists but is still empty. If the lockfile already exists, its payload is
 * read to decide whether the holder is still alive. A payload that parses is stale once
 * `now() - payload.timestamp >= staleMs`. A payload that cannot be parsed — including a file
 * still mid-write by another process — is judged by the lockfile's own mtime instead, and is only
 * treated as abandoned once `now() - mtimeMs >= staleMs`; this keeps a just-created or mid-write
 * lockfile from being broken out from under its holder while still letting a genuinely orphaned
 * corrupt lockfile self-heal once it ages past `staleMs`. Once a lockfile is judged stale, it is
 * removed and acquisition is retried exactly once. A fresh, live lockfile causes `withLock` to
 * return {@link LOCK_BUSY} immediately without invoking `action`. Once acquired, the lockfile is
 * always removed in a `finally` block, so a throwing `action` still releases the lock before its
 * error propagates to the caller.
 *
 * @param lockPath - Absolute path to the lockfile to create and remove
 * @param action - The work to perform while holding the lock
 * @param options - Staleness threshold and clock overrides, primarily for testing
 * @returns The result of `action`, or {@link LOCK_BUSY} if the lock is held by a live holder
 *
 * @example
 * ```ts
 * const result = await withLock(lockPath, () => refreshSkill(skillDir));
 * if (result === LOCK_BUSY) {
 *   return;
 * }
 * ```
 */
export async function withLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options?: WithLockOptions,
): Promise<T | LockBusy> {
  const staleMs = options?.staleMs ?? DEFAULT_STALE_MS;
  const now = options?.now ?? (() => Date.now());

  let acquired = await tryAcquire(lockPath, now);

  if (!acquired) {
    const stale = await isLockStale(lockPath, staleMs, now);
    if (!stale) {
      return LOCK_BUSY;
    }

    await rm(lockPath, { force: true });
    acquired = await tryAcquire(lockPath, now);
    if (!acquired) {
      return LOCK_BUSY;
    }
  }

  try {
    return await action();
  } finally {
    await rm(lockPath, { force: true });
  }
}
