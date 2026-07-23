import { access } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildGitEnv,
  cloneAtSha,
  GitOperationError,
  lsRemote,
  withTempClone,
  type GitRunner,
} from "../../src/resolver/git.js";

const repoUrl = "https://github.com/org/repo.git";
const sha = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2";

describe("lsRemote", () => {
  it("passes the exact argument vector and parses the SHA from realistic output", async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      return Promise.resolve({
        exitCode: 0,
        stdout: `${sha}\trefs/heads/main\n1111111111111111111111111111111111111111\trefs/tags/v1.0.0\n`,
      });
    };

    const result = await lsRemote(repoUrl, "main", runner);

    expect(calls).toEqual([["ls-remote", "--", repoUrl, "main"]]);
    expect(result).toBe(sha);
  });

  it("throws GitOperationError on nonzero exit", async () => {
    const runner: GitRunner = () =>
      Promise.resolve({ exitCode: 128, stdout: "" });

    await expect(lsRemote(repoUrl, "main", runner)).rejects.toThrow(
      GitOperationError,
    );
  });

  it("throws GitOperationError when the output has no valid SHA", async () => {
    const runner: GitRunner = () =>
      Promise.resolve({ exitCode: 0, stdout: "not-a-sha\trefs/heads/main\n" });

    await expect(lsRemote(repoUrl, "main", runner)).rejects.toThrow(
      GitOperationError,
    );
  });
});

describe("cloneAtSha", () => {
  it("issues a hardened clone, then fetches and checks out the exact sha", async () => {
    const calls: string[][] = [];
    const runner: GitRunner = (args) => {
      calls.push(args);
      return Promise.resolve({ exitCode: 0, stdout: "" });
    };

    await cloneAtSha(repoUrl, sha, "/tmp/das-dest", runner);

    expect(calls).toEqual([
      [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "-c",
        "protocol.ext.allow=never",
        "-c",
        "protocol.file.allow=never",
        "-c",
        "core.symlinks=false",
        "--no-recurse-submodules",
        "--",
        repoUrl,
        "/tmp/das-dest",
      ],
      ["-C", "/tmp/das-dest", "fetch", "--depth", "1", "--", "origin", sha],
      ["-C", "/tmp/das-dest", "checkout", sha],
    ]);
  });

  it("throws GitOperationError when the clone step exits nonzero", async () => {
    const runner: GitRunner = () =>
      Promise.resolve({ exitCode: 1, stdout: "" });

    await expect(
      cloneAtSha(repoUrl, sha, "/tmp/das-dest", runner),
    ).rejects.toThrow(GitOperationError);
  });

  it("throws GitOperationError when the fetch step exits nonzero", async () => {
    let callCount = 0;
    const runner: GitRunner = () => {
      callCount += 1;
      return Promise.resolve({ exitCode: callCount === 2 ? 1 : 0, stdout: "" });
    };

    await expect(
      cloneAtSha(repoUrl, sha, "/tmp/das-dest", runner),
    ).rejects.toThrow(GitOperationError);
  });

  it("throws GitOperationError when the checkout step exits nonzero", async () => {
    let callCount = 0;
    const runner: GitRunner = () => {
      callCount += 1;
      return Promise.resolve({ exitCode: callCount === 3 ? 1 : 0, stdout: "" });
    };

    await expect(
      cloneAtSha(repoUrl, sha, "/tmp/das-dest", runner),
    ).rejects.toThrow(GitOperationError);
  });
});

describe("buildGitEnv", () => {
  const sentinelVarName = "DAS_GIT_TEST_SENTINEL";

  beforeEach(() => {
    process.env[sentinelVarName] = "leaked";
  });

  afterEach(() => {
    Reflect.deleteProperty(process.env, sentinelVarName);
  });

  it("includes the required hardening vars and PATH, and excludes unrelated parent env vars", () => {
    const env = buildGitEnv();

    expect(env.GIT_TERMINAL_PROMPT).toBe("0");
    expect(env.GIT_ASKPASS).toBe("");
    expect(env.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(env.GIT_LFS_SKIP_SMUDGE).toBe("1");
    expect(env.PATH).toBe(process.env.PATH);
    expect(env[sentinelVarName]).toBeUndefined();
  });
});

describe("withTempClone", () => {
  it("removes the temp directory when the callback throws", async () => {
    const runner: GitRunner = () =>
      Promise.resolve({ exitCode: 0, stdout: "" });
    let capturedDir = "";

    await expect(
      withTempClone(
        repoUrl,
        sha,
        (dir) => {
          capturedDir = dir;
          return Promise.reject(new Error("callback failure"));
        },
        runner,
      ),
    ).rejects.toThrow("callback failure");

    await expect(access(capturedDir)).rejects.toThrow();
  });
});
