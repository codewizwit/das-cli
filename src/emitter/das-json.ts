import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** The current das.json schema version emitted by this build of the slicer. */
export const SLICER_VERSION = 1;

const skillNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const semverLikePattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const shaHexPattern = /^[0-9a-f]{40}$/;
const sourceHashPattern = /^sha256:[0-9a-f]{64}$/;

function isAbsoluteGeneratedPath(value: string): boolean {
  return (
    value.startsWith("/") ||
    value.startsWith("\\\\") ||
    /^[a-zA-Z]:[\\/]/.test(value)
  );
}

function containsParentSegment(value: string): boolean {
  return value.split(/[\\/]/).some((segment) => segment === "..");
}

const githubSourceSchema = z
  .object({
    type: z.literal("github"),
    url: z.string().min(1),
    subpath: z.union([z.string(), z.null()]),
  })
  .strict();

const pathSourceSchema = z
  .object({
    type: z.literal("path"),
    path: z.string().min(1),
    kind: z.enum(["file", "folder", "project"]),
  })
  .strict();

const dasJsonSourceSchema = z
  .discriminatedUnion("type", [githubSourceSchema, pathSourceSchema])
  .superRefine((source, ctx) => {
    if (source.type !== "github") {
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(source.url);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "github source url must be a valid URL",
        path: ["url"],
      });
      return;
    }

    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "github.com"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "github source url must use https and host github.com",
        path: ["url"],
      });
    }
  });

const generatedFilePathSchema = z
  .string()
  .min(1)
  .refine((value) => !isAbsoluteGeneratedPath(value), {
    message: "generatedFiles entries must be relative paths",
  })
  .refine((value) => !containsParentSegment(value), {
    message: "generatedFiles entries must not contain a .. segment",
  });

/**
 * Zod schema for the das.json record committed alongside each generated skill.
 *
 * `.strict()` is applied at every object level (this schema and both `source` union members)
 * so an unknown key anywhere in the record is rejected rather than silently stripped: das.json
 * is untrusted input to later deletion, and a tampered file with extra keys must fail loud
 * instead of being quietly sanitized.
 */
export const dasJsonSchema = z
  .object({
    dasVersion: z.string().min(1).regex(semverLikePattern),
    slicerVersion: z.number().int().positive(),
    name: z.string().min(1).max(64).regex(skillNamePattern),
    source: dasJsonSourceSchema,
    trackedRef: z.union([z.string(), z.null()]),
    pinnedSha: z.union([z.string().regex(shaHexPattern), z.null()]),
    sourceHash: z.string().regex(sourceHashPattern),
    tokenBudget: z.number().int().min(500).max(100000),
    includeLarge: z.boolean(),
    checkIntervalHours: z.number().min(0),
    lastRefresh: z.string().datetime({ offset: true }),
    generatedFiles: z.array(generatedFilePathSchema).min(1),
    oversized: z.array(z.string()).optional(),
  })
  .strict();

/** The durable, self-describing record committed alongside each generated skill. */
export type DasJson = z.infer<typeof dasJsonSchema>;

/** Thrown when a das.json record is missing, unparseable, or fails schema validation. */
export class InvalidDasJsonError extends Error {
  constructor(skillDir: string, reason: string) {
    super(`Invalid das.json in ${skillDir}: ${reason}`);
    this.name = "InvalidDasJsonError";
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

function dasJsonPathFor(skillDir: string): string {
  return join(skillDir, "das.json");
}

/**
 * Read and validate the das.json record for a generated skill.
 *
 * A das.json read from disk is untrusted input to operations that later delete or overwrite
 * files, so every field is validated before the record is trusted, including a strict
 * https-and-github.com check on github source URLs and a rejection (never a silent clamp) of
 * out-of-range numeric fields.
 *
 * @param skillDir - Absolute path to the skill directory containing das.json
 * @returns The validated das.json record
 * @throws {@link InvalidDasJsonError} When das.json is missing, unparseable, or invalid
 */
export async function readDasJson(skillDir: string): Promise<DasJson> {
  const dasJsonPath = dasJsonPathFor(skillDir);
  let raw: string;

  try {
    raw = await readFile(dasJsonPath, "utf-8");
  } catch {
    throw new InvalidDasJsonError(
      skillDir,
      `das.json not found at ${dasJsonPath}`,
    );
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new InvalidDasJsonError(skillDir, "das.json is not valid JSON");
  }

  const result = dasJsonSchema.safeParse(parsedJson);

  if (!result.success) {
    throw new InvalidDasJsonError(skillDir, formatZodError(result.error));
  }

  return result.data;
}

/**
 * Validate and write a das.json record for a generated skill.
 *
 * The record is validated before it is written so an invalid das.json can never be committed
 * to disk, since a later read trusts das.json to gate deletion and rebuild the manifest.
 *
 * @param skillDir - Absolute path to the skill directory to write das.json into
 * @param data - The das.json record to validate and persist
 * @throws {@link InvalidDasJsonError} When `data` fails schema validation
 */
export async function writeDasJson(
  skillDir: string,
  data: DasJson,
): Promise<void> {
  const result = dasJsonSchema.safeParse(data);

  if (!result.success) {
    throw new InvalidDasJsonError(skillDir, formatZodError(result.error));
  }

  const dasJsonPath = dasJsonPathFor(skillDir);
  await writeFile(
    dasJsonPath,
    `${JSON.stringify(result.data, null, 2)}\n`,
    "utf-8",
  );
}
