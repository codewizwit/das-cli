import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";

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

type LockStalenessJudgment =
  | { outcome: "absent" }
  | { outcome: "live"; content: string }
  | { outcome: "stale"; content: string };

async function judgeLockStaleness(
  lockPath: string,
  staleMs: number,
  now: () => number,
): Promise<LockStalenessJudgment> {
  let content: string;
  try {
    content = await readFile(lockPath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return { outcome: "absent" };
    }
    throw error;
  }

  const payload = parseLockPayload(content);
  if (payload) {
    const stale = now() - payload.timestamp >= staleMs;
    return { outcome: stale ? "stale" : "live", content };
  }

  const ageStale = await isLockFileAgeStale(lockPath, staleMs, now);
  return { outcome: ageStale ? "stale" : "live", content };
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

let breakAttemptSequence = 0;

/**
 * Break a lockfile judged stale and acquire it, without ever destroying a live holder's lock.
 *
 * The stale lockfile is claimed by renaming it aside, which is atomic: exactly one concurrent
 * caller can move a given path, so only one caller ever proceeds past this point for the same
 * stale lock. The claimed content is then re-checked against `staleContent`; a mismatch means a
 * live holder recreated the lockfile in the gap between judging it stale and claiming it, so the
 * claimed file is restored to `lockPath` on a best-effort basis and acquisition is abandoned.
 * Only when the claimed content matches the judged-stale content does this recreate `lockPath`
 * with the caller's own payload and discard the stale copy.
 *
 * @param lockPath - Absolute path to the lockfile being broken
 * @param staleContent - The exact bytes read from `lockPath` and judged stale
 * @param now - Clock used for the recreated lockfile's payload timestamp
 * @returns Whether the caller now holds the lock
 */
async function breakStaleLockAndAcquire(
  lockPath: string,
  staleContent: string,
  now: () => number,
): Promise<boolean> {
  const asidePath = `${lockPath}.breaking-${String(process.pid)}-${String(breakAttemptSequence++)}`;

  try {
    await rename(lockPath, asidePath);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const claimedContent = await readFile(asidePath, "utf-8");
  if (claimedContent !== staleContent) {
    await rename(asidePath, lockPath).catch(() => undefined);
    return false;
  }

  const acquired = await tryAcquire(lockPath, now);
  await rm(asidePath, { force: true });
  return acquired;
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
 * broken via an atomic rename-claim: the stale file is renamed aside, its content is re-verified
 * against what was judged stale, and only then is it recreated with this caller's own payload and
 * the aside copy discarded. This atomicity means that when multiple callers race to break the same
 * stale lock, at most one of them claims it and goes on to acquire and run `action` — the others
 * either see their rename fail (someone else already claimed it) or, if a live holder recreated the
 * lockfile in the gap, restore what they claimed and back off, never destroying a live holder's
 * lock. A fresh, live lockfile causes `withLock` to return {@link LOCK_BUSY} immediately without
 * invoking `action`. Once acquired, the lockfile is always removed in a `finally` block, so a
 * throwing `action` still releases the lock before its error propagates to the caller.
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
    const judgment = await judgeLockStaleness(lockPath, staleMs, now);
    if (judgment.outcome === "live") {
      return LOCK_BUSY;
    }

    acquired =
      judgment.outcome === "absent"
        ? await tryAcquire(lockPath, now)
        : await breakStaleLockAndAcquire(lockPath, judgment.content, now);

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
