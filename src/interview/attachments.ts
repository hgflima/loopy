/**
 * Interview attachments (C-0018 D9/D19) — persist a user attachment under the
 * target project's `.loopy/attachments/` and turn stored paths into ACP
 * `resource_link` prompt blocks.
 *
 * Two responsibilities, both free of loop behavior (AD-1):
 *
 *  - {@link writeAttachment} writes one attachment's bytes to
 *    `<dir>/.loopy/attachments/<YYYYMMDD-HHmmss>-<name>`. The timestamp prefix
 *    (D19) keeps two `print.png` from colliding, and attachments are **never
 *    deleted** — so a reference the `spec.md` wrote never dangles. `.loopy/` is
 *    already gitignored, so this leaves no repo footprint.
 *  - {@link attachmentBlocks} maps stored paths to well-formed `resource_link`
 *    {@link ContentBlock}s, the form the Interview session sends alongside the
 *    answer text ({@link LoopySession.promptBlocks}).
 *
 * A `name` that could escape the attachments dir (`..` or a path separator) is
 * rejected: the engine never lets GUI-provided text walk the tree.
 *
 * Node-only module (part of the `loopy interview` subcommand); it is **not** in
 * the browser-safe `config`/`backlog` barrels, so `node:fs` here is fine.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";

/** Attachments dir, relative to the target project root (D9). Gitignored. */
export const ATTACHMENTS_DIR = ".loopy/attachments";

/** Zero-pad a number to two digits for the timestamp prefix. */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Format a {@link Date} as `YYYYMMDD-HHmmss` in local time — the collision-proof
 * filename prefix (D19). Local time keeps the prefix legible to whoever opens
 * the folder.
 */
export function timestampPrefix(now: Date): string {
  const y = now.getFullYear();
  const mo = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const h = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const s = pad2(now.getSeconds());
  return `${y}${mo}${d}-${h}${mi}${s}`;
}

/**
 * Reject a `name` that could escape `.loopy/attachments/`: no `..` segment and
 * no path separator (`/` or `\`). The name is a single filename, nothing more.
 */
function assertSafeName(name: string): void {
  if (name.length === 0) {
    throw new Error("nome de anexo vazio");
  }
  if (name.includes("..") || name.includes("/") || name.includes("\\")) {
    throw new Error(
      `nome de anexo inválido: '${name}' — não pode conter '..' nem separador de caminho`,
    );
  }
}

/** Optional overrides for {@link writeAttachment} (testability). */
export interface WriteAttachmentOptions {
  /** Clock used for the filename prefix; defaults to the current time. */
  readonly now?: Date;
}

/**
 * Write one attachment under `<dir>/.loopy/attachments/`, prefixing the name
 * with a `YYYYMMDD-HHmmss` timestamp (D19). Creates the directory if needed and
 * returns the absolute path written — the caller stores that path (in the
 * command frame) and later feeds it to {@link attachmentBlocks}.
 */
export async function writeAttachment(
  dir: string,
  name: string,
  content: Uint8Array | string,
  options: WriteAttachmentOptions = {},
): Promise<string> {
  assertSafeName(name);
  const prefixed = `${timestampPrefix(options.now ?? new Date())}-${name}`;
  const destDir = join(dir, ATTACHMENTS_DIR);
  await mkdir(destDir, { recursive: true });
  const path = join(destDir, prefixed);
  await writeFile(path, content);
  return path;
}

/**
 * Map stored attachment paths to `resource_link` {@link ContentBlock}s — the
 * form the Interview session sends alongside the answer text. `name` is the
 * filename; `uri` is the `file://` URL so the agent can open it.
 */
export function attachmentBlocks(paths: readonly string[]): ContentBlock[] {
  return paths.map((path): ContentBlock => ({
    type: "resource_link",
    name: basename(path),
    uri: pathToFileURL(path).href,
  }));
}
