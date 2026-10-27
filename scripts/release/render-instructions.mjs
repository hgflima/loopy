#!/usr/bin/env node
// Renders `instructions_install.txt` for a release (C-0020, E9).
//
// The logic is a pure function (`renderInstructions`, AD-6): template + version +
// repo + npm package + the release's assets → the final text. It throws (never
// returns a "best effort" string) when a platform asset is missing, a placeholder
// is left over, or an input is malformed — an incomplete release must not ship a
// misleading install prompt. The repo always comes from the caller (`--repo`);
// nothing here names a concrete owner (E11).
//
// CLI (only when this module is the entrypoint):
//   node scripts/release/render-instructions.mjs --version X --repo o/r \
//     --npm-package P --assets assets.json > instructions_install.txt
// `assets.json` is a JSON array of `{ name, url? }`. The template is read relative
// to this script.

import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/**
 * Platform slots the template must be fed. Each asset is classified by its file
 * name, following the `tauri-action` naming (`Loopy_<ver>_<arch>.<ext>`;
 * NSIS → `..._x64-setup.exe`).
 */
export const PLATFORMS = [
  {
    key: "LINUX_APPIMAGE",
    label: "Linux AppImage",
    match: (n) => n.endsWith(".AppImage"),
  },
  { key: "LINUX_DEB", label: "Linux .deb", match: (n) => n.endsWith(".deb") },
  { key: "MACOS_DMG", label: "macOS .dmg", match: (n) => n.endsWith(".dmg") },
  {
    key: "WINDOWS_SETUP",
    label: "Windows NSIS (-setup.exe)",
    match: (n) => n.endsWith("-setup.exe"),
  },
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
const NPM_PACKAGE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PLACEHOLDER = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Classifies the release assets per platform. Throws if a platform has no asset
 * or more than one (ambiguous). Assets that match no platform (signatures,
 * updater archives, the instructions file itself) are ignored.
 */
export function classifyAssets(assets, { repo, version }) {
  if (!Array.isArray(assets))
    throw new Error("assets deve ser uma lista de { name, url }");
  const found = new Map();
  for (const asset of assets) {
    if (!asset || typeof asset.name !== "string" || asset.name === "") {
      throw new Error(`asset sem name: ${JSON.stringify(asset)}`);
    }
    const platform = PLATFORMS.find((p) => p.match(asset.name));
    if (!platform) continue;
    const prev = found.get(platform.key);
    if (prev) {
      throw new Error(
        `mais de um asset para ${platform.label}: ${prev.name}, ${asset.name}`,
      );
    }
    let url = asset.url;
    if (url === undefined) {
      url = `https://github.com/${repo}/releases/download/v${version}/${encodeURIComponent(asset.name)}`;
    } else if (typeof url !== "string" || !url.startsWith("https://")) {
      throw new Error(
        `url inválida para ${asset.name}: ${JSON.stringify(url)}`,
      );
    }
    found.set(platform.key, { name: asset.name, url });
  }
  const missing = PLATFORMS.filter((p) => !found.has(p.key)).map(
    (p) => p.label,
  );
  if (missing.length > 0) {
    throw new Error(
      `release incompleto — falta asset para: ${missing.join(", ")}`,
    );
  }
  return found;
}

/** template + release data → the final `instructions_install.txt` text. Pure. */
export function renderInstructions({
  template,
  version,
  repo,
  npmPackage,
  assets,
}) {
  if (typeof template !== "string" || template === "")
    throw new Error("template vazio");
  if (typeof version !== "string" || !SEMVER.test(version)) {
    throw new Error(`versão não-semver: ${JSON.stringify(version)}`);
  }
  if (typeof repo !== "string" || !REPO.test(repo)) {
    throw new Error(`repo fora do formato owner/name: ${JSON.stringify(repo)}`);
  }
  if (typeof npmPackage !== "string" || !NPM_PACKAGE.test(npmPackage)) {
    throw new Error(
      `nome de pacote npm inválido: ${JSON.stringify(npmPackage)}`,
    );
  }

  const values = { VERSION: version, REPO: repo, NPM_PACKAGE: npmPackage };
  for (const [key, { name, url }] of classifyAssets(assets, {
    repo,
    version,
  })) {
    values[`${key}_NAME`] = name;
    values[`${key}_URL`] = url;
  }

  const unknown = new Set();
  const out = template.replace(PLACEHOLDER, (whole, key) => {
    if (Object.hasOwn(values, key)) return values[key];
    unknown.add(key);
    return whole;
  });
  if (unknown.size > 0) {
    throw new Error(
      `placeholder sem valor no template: ${[...unknown].join(", ")}`,
    );
  }
  return out;
}

/** Default template path: next to this script. */
export const TEMPLATE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "instructions_install.template.txt",
);

function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: "string" },
      repo: { type: "string" },
      "npm-package": { type: "string" },
      assets: { type: "string" },
    },
    strict: true,
  });
  for (const flag of ["version", "repo", "npm-package", "assets"]) {
    if (!values[flag]) throw new Error(`flag obrigatória ausente: --${flag}`);
  }
  const assets = JSON.parse(readFileSync(values.assets, "utf8"));
  return renderInstructions({
    template: readFileSync(TEMPLATE_PATH, "utf8"),
    version: values.version,
    repo: values.repo,
    npmPackage: values["npm-package"],
    assets,
  });
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return (
      import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
    );
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  try {
    process.stdout.write(main(process.argv.slice(2)));
  } catch (err) {
    process.stderr.write(
      `render-instructions: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  }
}
