#!/usr/bin/env node
import { CommanderError } from "commander";
import { createProgram } from "../cli/index.js";

async function main(): Promise<void> {
  await createProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`das: ${message}\n`);
  process.exitCode = 1;
});
