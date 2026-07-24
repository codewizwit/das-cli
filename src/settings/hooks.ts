import { basename, dirname, join } from "node:path";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

const DAS_SESSION_START_COMMAND = "das refresh --hook";

/** Thrown when an existing settings file cannot be parsed as JSON, so it is refused rather than overwritten. */
export class SettingsParseError extends Error {
  constructor(settingsPath: string) {
    super(
      `Cannot parse existing settings file, refusing to overwrite: ${settingsPath}`,
    );
    this.name = "SettingsParseError";
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasDasSessionStartHook(sessionStart: unknown): boolean {
  if (!Array.isArray(sessionStart)) {
    return false;
  }

  return sessionStart.some((entry: unknown) => {
    if (!isRecord(entry) || !Array.isArray(entry.hooks)) {
      return false;
    }

    return entry.hooks.some(
      (hook: unknown) =>
        isRecord(hook) && hook.command === DAS_SESSION_START_COMMAND,
    );
  });
}

function createDasSessionStartEntry(): Record<string, unknown> {
  return {
    matcher: "startup",
    hooks: [
      {
        type: "command",
        command: DAS_SESSION_START_COMMAND,
        timeout: 60,
      },
    ],
  };
}

function hooksRecordOf(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  return isRecord(settings.hooks) ? settings.hooks : {};
}

function mergeDasHook(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const hooksValue = hooksRecordOf(settings);
  const sessionStartValue: unknown[] = Array.isArray(hooksValue.SessionStart)
    ? hooksValue.SessionStart
    : [];

  return {
    ...settings,
    hooks: {
      ...hooksValue,
      SessionStart: [...sessionStartValue, createDasSessionStartEntry()],
    },
  };
}

async function readSettingsOrUndefined(
  settingsPath: string,
): Promise<Record<string, unknown> | undefined> {
  let raw: string;

  try {
    raw = await readFile(settingsPath, "utf-8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SettingsParseError(settingsPath);
  }

  if (!isRecord(parsed)) {
    throw new SettingsParseError(settingsPath);
  }

  return parsed;
}

let tempFileSequence = 0;

async function writeSettingsAtomically(
  settingsPath: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const settingsDir = dirname(settingsPath);
  const tempPath = join(
    settingsDir,
    `.${basename(settingsPath)}.das-tmp-${String(process.pid)}-${String(tempFileSequence)}`,
  );
  tempFileSequence += 1;

  const serialized = `${JSON.stringify(settings, null, 2)}\n`;

  try {
    await writeFile(tempPath, serialized, "utf-8");
    JSON.parse(await readFile(tempPath, "utf-8"));
    await rename(tempPath, settingsPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * Install the DAS `SessionStart` hook (`das refresh --hook`) into a Claude Code settings.json.
 *
 * A missing file is created with only the DAS hook. An existing file is parsed and merged: every
 * other top-level key, every other hook event, and every other `SessionStart` entry is preserved
 * exactly, with the DAS entry appended to the `SessionStart` array. If the DAS hook is already
 * present, the file is left completely untouched. The write always goes through a temp file in the
 * same directory that is re-parsed before the atomic rename, so a malformed write can never leave
 * `settingsPath` in a broken state.
 *
 * @param settingsPath - Absolute path to the settings.json to read and update
 * @returns `"installed"` if the hook was added or the file was created, `"already-present"` if it already existed
 * @throws {@link SettingsParseError} When `settingsPath` exists but is not valid JSON
 */
export async function installSessionStartHook(
  settingsPath: string,
): Promise<"installed" | "already-present"> {
  const settings = (await readSettingsOrUndefined(settingsPath)) ?? {};
  const hooksValue = hooksRecordOf(settings);

  if (hasDasSessionStartHook(hooksValue.SessionStart)) {
    return "already-present";
  }

  await writeSettingsAtomically(settingsPath, mergeDasHook(settings));
  return "installed";
}

/**
 * Check whether the DAS `SessionStart` hook is already installed in a settings.json, without
 * reading it for the purpose of mutating it.
 *
 * This is the read-only counterpart to {@link installSessionStartHook}: callers that need to
 * decide *whether* to install (for example, to prompt a user only when the hook is absent) must
 * not call {@link installSessionStartHook} just to check, since it always installs when the hook
 * is missing. A missing settings.json is reported as `false`, not an error, matching
 * {@link installSessionStartHook}'s own treatment of a missing file; every other unreadable or
 * unparseable file is propagated rather than swallowed as "absent", since silently treating an
 * unreadable settings.json as "no hook" could otherwise mask a real problem the caller should see.
 *
 * @param settingsPath - Absolute path to the settings.json to check
 * @returns Whether a DAS SessionStart hook entry is already present
 * @throws {@link SettingsParseError} When `settingsPath` exists but is not valid JSON
 */
export async function isDasHookInstalled(
  settingsPath: string,
): Promise<boolean> {
  const settings = await readSettingsOrUndefined(settingsPath);

  if (settings === undefined) {
    return false;
  }

  return hasDasSessionStartHook(hooksRecordOf(settings).SessionStart);
}
