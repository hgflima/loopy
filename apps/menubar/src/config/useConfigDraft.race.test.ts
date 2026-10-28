/**
 * Overlapping loads (C-0020 T-013): on boot the persisted dir and the launch
 * argv dir load concurrently. Only the latest load() may write state —
 * otherwise a slow, older response lands last and mixes projects.
 *
 * Separate file because it needs `isTauri() === true` at module load.
 *
 * Run: `npm test -w apps/menubar -- useConfigDraft.race`
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const pending = new Map<string, (yml: string | null) => void>();

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn((cmd: string, args: { dir: string }) => {
    if (cmd === "read_project_files")
      return new Promise((resolve) => {
        pending.set(args.dir, (yml) => resolve({ loopy_yml: yml }));
      });
    return Promise.resolve(null);
  }),
}));

import { useConfigDraft } from "./useConfigDraft.js";

describe("useConfigDraft — overlapping loads", () => {
  it("a superseded load that resolves last does not overwrite the newer one", async () => {
    const { result } = renderHook(() => useConfigDraft());

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = result.current.load("/proj/old"); // e.g. the persisted dir
      newer = result.current.load("/proj/new"); // e.g. the launch argv dir
    });

    // The newer project has no loopy.yml (empty state)…
    await act(async () => {
      pending.get("/proj/new")!(null);
      await newer;
    });
    expect(result.current.hasConfig).toBe(false);

    // …and the older one, resolving late, must not resurrect its config.
    await act(async () => {
      pending.get("/proj/old")!('version: "1"\nname: old\n');
      await older;
    });
    expect(result.current.hasConfig).toBe(false);
    expect(result.current.draft).toBeNull();
  });
});
