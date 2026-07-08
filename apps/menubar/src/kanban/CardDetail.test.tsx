import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { CardDetail } from "./CardDetail";
import type { Transcript } from "../state/stream-history";

describe("CardDetail — shell rendering", () => {
  it("renders task id and title in the header", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={vi.fn()} />,
    );

    expect(container.querySelector(".card-detail__id")?.textContent).toBe("T-001");
    expect(container.querySelector(".card-detail__title")?.textContent).toBe("First task");
  });

  it("has the aside landmark with correct aria-label", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={vi.fn()} />,
    );

    const aside = container.querySelector("aside");
    expect(aside?.getAttribute("aria-label")).toBe("Detail for T-001");
  });

  it("renders the empty body area", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={vi.fn()} />,
    );

    expect(container.querySelector(".card-detail__body")).toBeTruthy();
  });
});

describe("CardDetail — close interactions", () => {
  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(
      <CardDetail taskId="T-001" title="First task" onClose={onClose} />,
    );

    const btn = container.querySelector(".card-detail__close") as HTMLElement;
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <CardDetail taskId="T-001" title="First task" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose on other keys", () => {
    const onClose = vi.fn();
    render(
      <CardDetail taskId="T-001" title="First task" onClose={onClose} />,
    );

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// T-011 — description (markdown)
// ---------------------------------------------------------------------------

describe("CardDetail — description", () => {
  it("renders description as markdown when provided", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First task"
        onClose={vi.fn()}
        description="A **bold** description"
        tasks={[]}
        transcript={{}}
      />,
    );

    const section = container.querySelector(".card-detail__desc");
    expect(section).toBeTruthy();
    expect(section?.querySelector("strong")?.textContent).toBe("bold");
  });

  it("hides description section when description is undefined", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First task"
        onClose={vi.fn()}
        tasks={[]}
        transcript={{}}
      />,
    );

    expect(container.querySelector(".card-detail__desc")).toBeNull();
  });

  it("hides description section when description is empty string", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First task"
        onClose={vi.fn()}
        description=""
        tasks={[]}
        transcript={{}}
      />,
    );

    expect(container.querySelector(".card-detail__desc")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-011 — deps chips with status dots
// ---------------------------------------------------------------------------

describe("CardDetail — deps chips", () => {
  it("renders dep chips with status dots", () => {
    const { container } = render(
      <CardDetail
        taskId="T-003"
        title="Third"
        onClose={vi.fn()}
        deps={["T-001", "T-002"]}
        tasks={[
          { id: "T-001", status: "done" },
          { id: "T-002", status: "running" },
        ]}
        transcript={{}}
      />,
    );

    const chips = container.querySelectorAll(".card-detail__dep-chip");
    expect(chips.length).toBe(2);
    expect(chips[0]?.textContent).toContain("T-001");
    expect(chips[1]?.textContent).toContain("T-002");

    // Each chip has a status dot
    expect(chips[0]?.querySelector(".status-dot")).toBeTruthy();
    expect(chips[1]?.querySelector(".status-dot")).toBeTruthy();

    // First dep is done → done tone
    expect(chips[0]?.querySelector(".status-dot--done")).toBeTruthy();
    // Second dep is running → running tone
    expect(chips[1]?.querySelector(".status-dot--running")).toBeTruthy();
  });

  it("renders pending dot for unknown deps", () => {
    const { container } = render(
      <CardDetail
        taskId="T-002"
        title="Second"
        onClose={vi.fn()}
        deps={["T-001"]}
        tasks={[]}
        transcript={{}}
      />,
    );

    const chip = container.querySelector(".card-detail__dep-chip");
    expect(chip).toBeTruthy();
    // Unknown dep → pending → neutral tone, hollow
    expect(chip?.querySelector(".status-dot--neutral")).toBeTruthy();
  });

  it("hides deps section when deps is undefined", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First"
        onClose={vi.fn()}
        tasks={[]}
        transcript={{}}
      />,
    );

    expect(container.querySelector(".card-detail__deps")).toBeNull();
  });

  it("hides deps section when deps is empty array", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First"
        onClose={vi.fn()}
        deps={[]}
        tasks={[]}
        transcript={{}}
      />,
    );

    expect(container.querySelector(".card-detail__deps")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-011 — log (persisted transcript)
// ---------------------------------------------------------------------------

describe("CardDetail — log (transcript)", () => {
  it("renders transcript segments with step dividers", () => {
    const transcript: Transcript = {
      "T-001": [
        { stepId: "build", text: "Building..." },
        { stepId: "build", text: " done." },
        { stepId: "test", text: "Testing..." },
      ],
    };

    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First"
        onClose={vi.fn()}
        tasks={[]}
        transcript={transcript}
      />,
    );

    const log = container.querySelector(".card-detail__log");
    expect(log).toBeTruthy();

    // One divider between "build" and "test" segments
    const dividers = container.querySelectorAll(".step-divider");
    expect(dividers.length).toBe(1);
    expect(dividers[0]?.textContent).toContain("test");
  });

  it("hides log section when transcript is empty", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First"
        onClose={vi.fn()}
        tasks={[]}
        transcript={{}}
      />,
    );

    expect(container.querySelector(".card-detail__log")).toBeNull();
  });

  it("preserves log after task finishes (transcript survives)", () => {
    const transcript: Transcript = {
      "T-001": [{ stepId: "build", text: "Completed build" }],
    };

    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First"
        onClose={vi.fn()}
        tasks={[{ id: "T-001", status: "done" }]}
        transcript={transcript}
      />,
    );

    const log = container.querySelector(".card-detail__log");
    expect(log).toBeTruthy();
    expect(log?.textContent).toContain("Completed build");
  });
});

// ---------------------------------------------------------------------------
// T-011 — graceful empty state (--emit-events off)
// ---------------------------------------------------------------------------

describe("CardDetail — graceful empty state", () => {
  it("renders without breaking when all content is empty", () => {
    const { container } = render(
      <CardDetail
        taskId="T-001"
        title="First"
        onClose={vi.fn()}
        tasks={[]}
        transcript={{}}
      />,
    );

    const body = container.querySelector(".card-detail__body");
    expect(body).toBeTruthy();
    // No content sections rendered
    expect(body?.children.length).toBe(0);
  });

  it("works with no optional props (backward-compatible shell)", () => {
    const { container } = render(
      <CardDetail taskId="T-001" title="First" onClose={vi.fn()} />,
    );

    expect(container.querySelector(".card-detail")).toBeTruthy();
    expect(container.querySelector(".card-detail__body")).toBeTruthy();
  });
});
