/**
 * Tests for the Interview attachments module (C-0018 T-004).
 *
 * Two pure-ish responsibilities:
 *  - `writeAttachment` persists bytes under `<dir>/.loopy/attachments/` with a
 *    `YYYYMMDD-HHmmss` prefix (D19), and rejects a name that could escape the
 *    directory (`..` or a path separator).
 *  - `attachmentBlocks` maps stored paths to well-formed `resource_link`
 *    ContentBlocks.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ATTACHMENTS_DIR,
  attachmentBlocks,
  timestampPrefix,
  writeAttachment,
} from "../../src/interview/attachments";

describe("timestampPrefix", () => {
  it("formats a Date as YYYYMMDD-HHmmss (local time, zero-padded)", () => {
    expect(timestampPrefix(new Date("2026-07-25T14:30:12"))).toBe(
      "20260725-143012",
    );
    // Zero-padding for single-digit month/day/hour/minute/second.
    expect(timestampPrefix(new Date("2026-01-05T04:03:09"))).toBe(
      "20260105-040309",
    );
  });
});

describe("writeAttachment", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "loopy-attach-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes under .loopy/attachments/ with a timestamp prefix and returns the path", async () => {
    const now = new Date("2026-07-25T14:30:12");
    const path = await writeAttachment(
      dir,
      "erro.png",
      Buffer.from("PNGDATA"),
      {
        now,
      },
    );

    // Path lands under .loopy/attachments/ with the YYYYMMDD-HHmmss prefix (D19).
    expect(path).toBe(join(dir, ATTACHMENTS_DIR, "20260725-143012-erro.png"));
    expect(dirname(path)).toBe(join(dir, ATTACHMENTS_DIR));
    expect(basename(path)).toMatch(/^\d{8}-\d{6}-erro\.png$/);

    // The bytes actually landed on disk.
    const written = await readFile(path);
    expect(written.toString()).toBe("PNGDATA");
  });

  it("writes string content and defaults the timestamp to now", async () => {
    const path = await writeAttachment(dir, "note.txt", "hello");
    expect(basename(path)).toMatch(/^\d{8}-\d{6}-note\.txt$/);
    expect((await readFile(path)).toString()).toBe("hello");
  });

  it("does not collide when two attachments share a base name (distinct paths)", async () => {
    const a = await writeAttachment(dir, "print.png", "a", {
      now: new Date("2026-07-25T14:30:12"),
    });
    const b = await writeAttachment(dir, "print.png", "b", {
      now: new Date("2026-07-25T14:30:13"),
    });
    expect(a).not.toBe(b);
    expect((await readFile(a)).toString()).toBe("a");
    expect((await readFile(b)).toString()).toBe("b");
  });

  it("rejects a name containing '..'", async () => {
    await expect(writeAttachment(dir, "../escape.png", "x")).rejects.toThrow(
      /inválido/,
    );
  });

  it("rejects a name containing a path separator", async () => {
    await expect(writeAttachment(dir, "sub/evil.png", "x")).rejects.toThrow(
      /inválido/,
    );
    await expect(writeAttachment(dir, "sub\\evil.png", "x")).rejects.toThrow(
      /inválido/,
    );
  });

  it("rejects an empty name", async () => {
    await expect(writeAttachment(dir, "", "x")).rejects.toThrow();
  });
});

describe("attachmentBlocks", () => {
  it("builds well-formed resource_link ContentBlocks from paths", () => {
    const paths = [
      "/tmp/proj/.loopy/attachments/20260725-143012-erro.png",
      "/tmp/proj/.loopy/attachments/20260725-143013-log.txt",
    ];

    const blocks = attachmentBlocks(paths);
    expect(blocks).toHaveLength(2);

    blocks.forEach((block, i) => {
      expect(block.type).toBe("resource_link");
      if (block.type !== "resource_link") throw new Error("unreachable");
      expect(block.name).toBe(basename(paths[i]!));
      expect(block.uri).toBe(pathToFileURL(paths[i]!).href);
      expect(block.uri.startsWith("file://")).toBe(true);
    });
  });

  it("returns an empty array when there are no paths", () => {
    expect(attachmentBlocks([])).toEqual([]);
  });
});
