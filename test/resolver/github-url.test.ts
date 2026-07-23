import { describe, expect, it } from "vitest";
import {
  parseGithubUrl,
  UnsupportedSourceError,
} from "../../src/resolver/github-url.js";

describe("parseGithubUrl", () => {
  describe("accepted forms", () => {
    it.each([
      [
        "bare repo URL",
        "https://github.com/octocat/hello-world",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: null,
          subpath: null,
        },
      ],
      [
        "repo URL with .git suffix",
        "https://github.com/octocat/hello-world.git",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: null,
          subpath: null,
        },
      ],
      [
        "tree URL with ref only",
        "https://github.com/octocat/hello-world/tree/main",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: "main",
          subpath: null,
        },
      ],
      [
        "tree URL with ref and subpath",
        "https://github.com/octocat/hello-world/tree/main/docs",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: "main",
          subpath: "docs",
        },
      ],
      [
        "tree URL with ref and nested subpath",
        "https://github.com/octocat/hello-world/tree/v2/docs/guides/setup",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: "v2",
          subpath: "docs/guides/setup",
        },
      ],
      [
        "blob URL with filepath",
        "https://github.com/octocat/hello-world/blob/v2/README.md",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: "v2",
          subpath: "README.md",
        },
      ],
      [
        "blob URL with nested filepath",
        "https://github.com/octocat/hello-world/blob/main/docs/guide.md",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: "main",
          subpath: "docs/guide.md",
        },
      ],
      [
        "host is case-insensitive",
        "https://GitHub.com/octocat/hello-world",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: null,
          subpath: null,
        },
      ],
      [
        "org and repo segments with allowed punctuation",
        "https://github.com/my-org_1/my.repo_2",
        {
          url: "https://github.com/my-org_1/my.repo_2.git",
          ref: null,
          subpath: null,
        },
      ],
      [
        "semver-ish ref with nested subpath",
        "https://github.com/octocat/hello-world/tree/v2.1.0/docs/guides/intro",
        {
          url: "https://github.com/octocat/hello-world.git",
          ref: "v2.1.0",
          subpath: "docs/guides/intro",
        },
      ],
      [
        ".git suffix is stripped case-insensitively",
        "https://github.com/octocat/REPO.GIT",
        {
          url: "https://github.com/octocat/REPO.git",
          ref: null,
          subpath: null,
        },
      ],
    ])("%s", (_description, input, expected) => {
      expect(parseGithubUrl(input)).toEqual(expected);
    });
  });

  describe("rejected forms", () => {
    it.each([
      ["input starting with a dash", "-oProxyCommand=touch pwned"],
      ["scp-style ssh shorthand", "git@github.com:octocat/hello-world.git"],
      ["plain http scheme", "http://github.com/octocat/hello-world"],
      ["ssh scheme", "ssh://git@github.com/octocat/hello-world.git"],
      ["git scheme", "git://github.com/octocat/hello-world.git"],
      ["ext transport helper", 'ext::sh -c "touch pwned"'],
      ["file scheme", "file:///etc/passwd"],
      ["subdomain host", "https://gist.github.com/octocat/hello-world"],
      ["lookalike host", "https://github.com.evil.com/octocat/hello-world"],
      [
        "credentials in the URL",
        "https://user:pass@github.com/octocat/hello-world",
      ],
      ["explicit port", "https://github.com:8080/octocat/hello-world"],
      ["query string", "https://github.com/octocat/hello-world?ref=main"],
      ["fragment", "https://github.com/octocat/hello-world#readme"],
      ["fewer than two path segments", "https://github.com/octocat"],
      ["no path segments", "https://github.com"],
      [
        "org segment with disallowed characters",
        "https://github.com/oct%40cat/hello-world",
      ],
      [
        "repo segment with disallowed characters",
        "https://github.com/octocat/hello world",
      ],
      [
        "org segment is exactly a single dot",
        "https://github.com/./hello-world",
      ],
      [
        "org segment is exactly a double dot",
        "https://github.com/../hello-world",
      ],
      ["repo segment is exactly a single dot", "https://github.com/octocat/."],
      ["repo segment is exactly a double dot", "https://github.com/octocat/.."],
      ["empty string", ""],
      ["whitespace only", "   "],
      [
        "unsupported path form after org/repo",
        "https://github.com/octocat/hello-world/issues",
      ],
      ["tree form with no ref", "https://github.com/octocat/hello-world/tree"],
      ["blob form with no ref", "https://github.com/octocat/hello-world/blob"],
      [
        "blob form with ref but no filepath",
        "https://github.com/octocat/hello-world/blob/main",
      ],
      [
        "ref is a flag-injection payload",
        "https://github.com/octocat/hello-world/tree/--upload-pack=touch%20pwned",
      ],
      [
        "ref starts with a dash",
        "https://github.com/octocat/hello-world/tree/-oProxyCommand=x",
      ],
      [
        "subpath segment starts with a dash",
        "https://github.com/octocat/hello-world/tree/main/-rf",
      ],
      [
        "subpath segment is a percent-encoded traversal payload",
        "https://github.com/octocat/hello-world/tree/main/a%2f..%2f..%2fetc%2fpasswd",
      ],
      [
        "default https port made explicit",
        "https://github.com:443/octocat/hello-world",
      ],
    ])("%s", (_description, input) => {
      expect(() => parseGithubUrl(input)).toThrow(UnsupportedSourceError);
    });
  });
});
