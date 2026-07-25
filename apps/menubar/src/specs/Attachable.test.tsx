/**
 * Tests for Attachable: the paste / drag-drop / 📎 file-attach wrapper.
 *
 * jsdom does not implement URL.createObjectURL, so the image path is only
 * reachable with the stub below; the plain-file path never touches it.
 *
 * Run: `npm test -w apps/menubar -- specs`
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";

afterEach(cleanup);

const { Attachable } = await import("./Attachable");
import type { Attachment } from "./Attachable";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fires a paste carrying `files`, since jsdom's ClipboardEvent has no data. */
function pasteFiles(node: Element, files: readonly File[]): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files } });
  fireEvent(node, event);
}

/** Renders Attachable with a controlled attachments list captured per test. */
function renderAttachable(hint?: string) {
  let current: readonly Attachment[] = [];
  const onChange = vi.fn((next: readonly Attachment[]) => {
    current = next;
  });
  const utils = render(
    <Attachable attachments={current} onChange={onChange} hint={hint}>
      <textarea aria-label="resposta" />
    </Attachable>,
  );
  return {
    ...utils,
    onChange,
    get attachments() {
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// Paste
// ---------------------------------------------------------------------------

describe("Attachable — paste", () => {
  it("pasting a file produces a chip with its name and size", () => {
    const { container, onChange } = renderAttachable();
    const zone = container.querySelector(".spec-attach")!;
    const file = new File(["12345"], "erro.log", { type: "text/plain" });

    pasteFiles(zone, [file]);

    // The wrapper lifts the new attachment set.
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as readonly Attachment[];
    expect(next).toHaveLength(1);
    expect(next[0]!.name).toBe("erro.log");
    expect(next[0]!.size).toBe(5);
    expect(next[0]!.kind).toBe("file");
  });

  it("renders a chip with the name and a human-readable size", () => {
    const attachment: Attachment = {
      id: "a1",
      name: "captura.png",
      size: 2048,
      kind: "file",
    };
    const { container } = render(
      <Attachable attachments={[attachment]} onChange={vi.fn()}>
        <textarea aria-label="resposta" />
      </Attachable>,
    );
    const chip = container.querySelector(".spec-chip")!;
    expect(chip.textContent).toContain("captura.png");
    expect(chip.textContent).toContain("2 KB");
  });
});

// ---------------------------------------------------------------------------
// 📎 button — the file input must be reusable for the same file twice
// ---------------------------------------------------------------------------

describe("Attachable — file input", () => {
  it("clears the input value after a pick so re-picking the same file fires", () => {
    const { container } = renderAttachable();
    const input =
      container.querySelector<HTMLInputElement>("input[type=file]")!;
    const file = new File(["x"], "a.log", { type: "text/plain" });

    // Simulate a pick: jsdom lets us assign files, then fire change.
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    fireEvent.change(input);

    // The handler resets value to "" so selecting the same file re-fires.
    expect(input.value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Images — object URL is created and revoked on removal
// ---------------------------------------------------------------------------

describe("Attachable — image thumbnails", () => {
  beforeEach(() => {
    // jsdom lacks these; the image branch needs them.
    URL.createObjectURL = vi.fn(() => "blob:mock-url");
    URL.revokeObjectURL = vi.fn();
  });

  it("gives an image a thumbnail via createObjectURL", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Attachable attachments={[]} onChange={onChange}>
        <textarea aria-label="resposta" />
      </Attachable>,
    );
    const zone = container.querySelector(".spec-attach")!;
    const png = new File(["binary"], "print.png", { type: "image/png" });

    pasteFiles(zone, [png]);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as readonly Attachment[];
    expect(next[0]!.kind).toBe("image");
    expect(next[0]!.url).toBe("blob:mock-url");
  });

  it("revokes the object URL when the chip is removed", () => {
    const onChange = vi.fn();
    const image: Attachment = {
      id: "img1",
      name: "print.png",
      size: 10,
      kind: "image",
      url: "blob:mock-url",
    };
    const { container } = render(
      <Attachable attachments={[image]} onChange={onChange}>
        <textarea aria-label="resposta" />
      </Attachable>,
    );
    const remove = container.querySelector<HTMLButtonElement>(".spec-chip__x")!;
    fireEvent.click(remove);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

// ---------------------------------------------------------------------------
// Drag & drop overlay
// ---------------------------------------------------------------------------

describe("Attachable — drag and drop", () => {
  it("shows the overlay while a file is dragged over", () => {
    const { container } = renderAttachable();
    const zone = container.querySelector(".spec-attach")!;

    expect(container.querySelector(".spec-attach__overlay")).toBeNull();
    fireEvent.dragOver(zone);
    expect(container.querySelector(".spec-attach__overlay")).not.toBeNull();
    fireEvent.dragLeave(zone);
    expect(container.querySelector(".spec-attach__overlay")).toBeNull();
  });

  it("adds dropped files", () => {
    const onChange = vi.fn();
    const { container } = render(
      <Attachable attachments={[]} onChange={onChange}>
        <textarea aria-label="resposta" />
      </Attachable>,
    );
    const zone = container.querySelector(".spec-attach")!;
    const file = new File(["abc"], "trace.log", { type: "text/plain" });

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as readonly Attachment[];
    expect(next[0]!.name).toBe("trace.log");
  });
});
