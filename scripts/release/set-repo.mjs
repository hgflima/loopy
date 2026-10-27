#!/usr/bin/env node
// set-repo.mjs <owner/repo> — point the root package.json's `repository`,
// `bugs` and `homepage` at another GitHub repo (E11).
//
// The repo is never hardcoded anywhere in the release tooling: CI derives it
// from `${{ github.repository }}`, and this script is the single place that
// rewrites the three npm metadata fields when the project moves. The decision
// lives in the pure `setRepo` (AD-6); the CLI below is thin I/O around it.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// GitHub owner: alphanumerics and single inner hyphens. Repo: alphanumerics,
// `.`, `_`, `-`. Anything else (a bare name, a URL, extra path segments) is a
// mistake we refuse rather than write into package.json.
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;

/**
 * Validate an `owner/repo` slug. Returns the slug or throws with a message
 * fit for the CLI's stderr.
 * @param {unknown} repo
 * @returns {string}
 */
export function parseRepo(repo) {
  if (
    typeof repo !== "string" ||
    !REPO_RE.test(repo) ||
    repo.endsWith("/.") ||
    repo.endsWith("/..")
  ) {
    throw new Error(
      `repositório inválido: ${JSON.stringify(repo)} — esperado no formato owner/repo`,
    );
  }
  return repo;
}

/**
 * Return a copy of `pkg` with `repository.url`, `bugs.url` and `homepage`
 * pointing at `https://github.com/<repo>`. Other fields — and other keys of
 * `repository`/`bugs` (e.g. `type`, `directory`, `email`) — are untouched, and
 * key order is preserved (existing keys are reassigned in place).
 * @template {Record<string, unknown>} T
 * @param {T} pkg
 * @param {string} repo `owner/repo`
 * @returns {T}
 */
export function setRepo(pkg, repo) {
  const slug = parseRepo(repo);
  const base = `https://github.com/${slug}`;
  const repository = isObject(pkg.repository)
    ? { ...pkg.repository, url: `git+${base}.git` }
    : { type: "git", url: `git+${base}.git` };
  const bugs = isObject(pkg.bugs)
    ? { ...pkg.bugs, url: `${base}/issues` }
    : { url: `${base}/issues` };
  return { ...pkg, repository, bugs, homepage: `${base}#readme` };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function main(argv) {
  const [repo, ...rest] = argv;
  if (repo === undefined || rest.length > 0) {
    process.stderr.write(
      "uso: node scripts/release/set-repo.mjs <owner/repo>\n",
    );
    return 2;
  }
  const here = fileURLToPath(new URL(".", import.meta.url));
  const file = resolve(here, "../../package.json");
  try {
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, `${JSON.stringify(setRepo(pkg, repo), null, 2)}\n`);
  } catch (err) {
    process.stderr.write(
      `set-repo: ${err instanceof Error ? err.message : err}\n`,
    );
    return 1;
  }
  process.stdout.write(`package.json agora aponta para ${repo}\n`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
