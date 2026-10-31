#!/usr/bin/env node
/**
 * Compila o motor (`../../src/index.ts`) num executável único com `bun build
 * --compile` e o grava onde o Tauri o procura: `src-tauri/bin/loopy-<triple>`
 * (`externalBin: ["bin/loopy"]`). O triple é o do HOST, lido de `rustc -vV` —
 * o mesmo que o `TAURI_ENV_TARGET_TRIPLE` que `sidecar.rs` embute ao compilar.
 *
 * Cross-platform de propósito (substitui um one-liner com o triple
 * `aarch64-apple-darwin` hardcoded): no Windows o sufixo é `.exe`; o `codesign`
 * ad-hoc só roda no macOS. Ver docs/how-to/plataformas.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

function hostTriple() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const triple = /^host:\s*(\S+)/m.exec(out)?.[1];
  if (!triple)
    throw new Error("build-sidecar: `rustc -vV` não informou o host triple.");
  return triple;
}

const triple = process.env.TAURI_ENV_TARGET_TRIPLE || hostTriple();
const outfile = join(
  appDir,
  "src-tauri",
  "bin",
  `loopy-${triple}${isWindows ? ".exe" : ""}`,
);
mkdirSync(dirname(outfile), { recursive: true });

execFileSync(
  "bun",
  [
    "build",
    "--compile",
    join(appDir, "..", "..", "src", "index.ts"),
    // `loopy open` só procura a GUI ao lado do executável quando é este binário
    // (src/open/launch.ts, `isBundled`) — sob Node, essa pasta é a do npm.
    "--define",
    "__LOOPY_BUNDLED__=true",
    "--outfile",
    outfile,
  ],
  { stdio: "inherit", shell: isWindows },
);

if (process.platform === "darwin") {
  try {
    execFileSync("codesign", ["--remove-signature", outfile], {
      stdio: "ignore",
    });
  } catch {
    // binário recém-gerado pode não ter assinatura — segue para a ad-hoc
  }
  execFileSync("codesign", ["-f", "-s", "-", outfile], { stdio: "inherit" });
}

console.log(`build-sidecar: ${outfile}`);
