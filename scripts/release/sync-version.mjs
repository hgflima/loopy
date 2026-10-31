#!/usr/bin/env node
// sync-version.mjs <versão> — grava a versão do release na raiz, no menubar e
// nas entradas correspondentes do package-lock.json (E4).
//
// Uma versão, uma fonte: o package.json da raiz. O semantic-release chama este
// script no `prepareCmd` do @semantic-release/exec com `${nextRelease.version}`
// e o @semantic-release/git commita os três arquivos de volta. A decisão vive
// na pura `syncVersion` (AD-6); o CLI abaixo é I/O fino em volta.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Caminhos (relativos à raiz do repo) dos arquivos que carregam a versão. */
export const VERSION_FILES = Object.freeze({
  root: "package.json",
  menubar: "apps/menubar/package.json",
  lock: "package-lock.json",
});

/** Chave do workspace do menubar em `package-lock.json#packages`. */
const MENUBAR_LOCK_KEY = "apps/menubar";

// SemVer 2.0.0 (regex oficial de semver.org), sem prefixo `v`.
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * Valida uma versão semver (sem `v`). Devolve a versão ou lança.
 * @param {unknown} version
 * @returns {string}
 */
export function parseVersion(version) {
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(
      `versão inválida: ${JSON.stringify(version)} — esperado semver (ex.: 1.2.3)`,
    );
  }
  return version;
}

/**
 * Cópia dos três manifestos com a versão gravada na raiz, no menubar e, no
 * lockfile, no topo, em `packages[""]` e em `packages["apps/menubar"]`. Não
 * muta a entrada; demais campos e a ordem das chaves ficam intactos. Lança em
 * versão não-semver ou em lockfile sem as entradas esperadas.
 * @template {{ root: Record<string, unknown>, menubar: Record<string, unknown>, lock: Record<string, unknown> }} F
 * @param {F} files
 * @param {string} version
 * @returns {F}
 */
export function syncVersion(files, version) {
  const v = parseVersion(version);
  const packages = files.lock.packages;
  if (
    !isObject(packages) ||
    !isObject(packages[""]) ||
    !isObject(packages[MENUBAR_LOCK_KEY])
  ) {
    throw new Error(
      `package-lock.json sem as entradas packages[""] e packages["${MENUBAR_LOCK_KEY}"]`,
    );
  }
  return {
    ...files,
    root: { ...files.root, version: v },
    menubar: { ...files.menubar, version: v },
    lock: {
      ...files.lock,
      version: v,
      packages: {
        ...packages,
        "": { ...packages[""], version: v },
        [MENUBAR_LOCK_KEY]: { ...packages[MENUBAR_LOCK_KEY], version: v },
      },
    },
  };
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function main(argv) {
  const [version, ...rest] = argv;
  if (version === undefined || rest.length > 0) {
    process.stderr.write(
      "uso: node scripts/release/sync-version.mjs <versão>\n",
    );
    return 2;
  }
  const repoRoot = resolve(
    fileURLToPath(new URL(".", import.meta.url)),
    "../..",
  );
  const paths = Object.fromEntries(
    Object.entries(VERSION_FILES).map(([k, rel]) => [
      k,
      resolve(repoRoot, rel),
    ]),
  );
  try {
    const files = Object.fromEntries(
      Object.entries(paths).map(([k, p]) => [
        k,
        JSON.parse(readFileSync(p, "utf8")),
      ]),
    );
    const out = syncVersion(files, version);
    for (const [k, p] of Object.entries(paths)) {
      writeFileSync(p, `${JSON.stringify(out[k], null, 2)}\n`);
    }
  } catch (err) {
    process.stderr.write(
      `sync-version: ${err instanceof Error ? err.message : err}\n`,
    );
    return 1;
  }
  process.stdout.write(`versão sincronizada: ${version}\n`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
