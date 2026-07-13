/**
 * Tests for T-007: field primitives (Text/Number/Select/Toggle/Record/CommandList).
 *
 * Covers acceptance criteria:
 *  - SelectField only renders the given options (SC5 — never a value outside enum);
 *  - NumberField rejects/normalizes non-numeric input;
 *  - RecordEditor add/remove preserves order;
 *  - CommandListEditor add/remove/reorder preserves order;
 *  - Error renders inline for each field type;
 *  - Zero color literals in the stylesheet (tokens only).
 *
 * Run: `npm test -w apps/menubar -- fields`
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { TextField } from "./TextField";
import { NumberField } from "./NumberField";
import { SelectField } from "./SelectField";
import { ToggleField } from "./ToggleField";
import { RecordEditor } from "./RecordEditor";
import { CommandListEditor } from "./CommandListEditor";

afterEach(cleanup);

/* ---- TextField -------------------------------------------------------- */

describe("TextField", () => {
  it("renders label, input, and hint", () => {
    render(
      <TextField label="Name" value="hello" onChange={() => {}} hint="A hint" />,
    );
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByDisplayValue("hello")).toBeTruthy();
    expect(screen.getByText("A hint")).toBeTruthy();
  });

  it("calls onChange with the new value", () => {
    const onChange = vi.fn();
    render(<TextField label="Name" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    expect(onChange).toHaveBeenCalledWith("x");
  });

  it("renders error inline and hides hint", () => {
    render(
      <TextField label="Name" value="" onChange={() => {}} error="Required" hint="A hint" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.queryByText("A hint")).toBeNull();
  });
});

/* ---- NumberField ------------------------------------------------------- */

describe("NumberField", () => {
  it("renders the numeric value as text", () => {
    render(<NumberField label="Count" value={5} onChange={() => {}} />);
    expect(screen.getByDisplayValue("5")).toBeTruthy();
  });

  it("parses valid integer input", () => {
    const onChange = vi.fn();
    render(<NumberField label="Count" value={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("rejects non-numeric input (onChange not called)", () => {
    const onChange = vi.fn();
    render(<NumberField label="Count" value={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clamps to min when provided", () => {
    const onChange = vi.fn();
    render(<NumberField label="Count" value={5} onChange={onChange} min={1} />);
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "-3" } });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("defaults to min on empty input when min is set", () => {
    const onChange = vi.fn();
    render(<NumberField label="Count" value={5} onChange={onChange} min={1} />);
    fireEvent.change(screen.getByLabelText("Count"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(1);
  });

  it("renders error inline", () => {
    render(
      <NumberField label="Count" value={0} onChange={() => {}} error="Must be positive" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Must be positive")).toBeTruthy();
  });
});

/* ---- SelectField (SC5 — closed enum) ---------------------------------- */

describe("SelectField", () => {
  const options = ["pause", "skip_task", "abort_loop"] as const;

  it("renders only the given options — never more", () => {
    render(
      <SelectField
        label="Action"
        value="pause"
        onChange={() => {}}
        options={options}
      />,
    );
    const optionElements = screen.getAllByRole("option");
    expect(optionElements).toHaveLength(3);
    const values = optionElements.map((el) => (el as HTMLOptionElement).value);
    expect(values).toEqual(["pause", "skip_task", "abort_loop"]);
  });

  it("does not render a value outside the options array", () => {
    render(
      <SelectField
        label="Action"
        value="pause"
        onChange={() => {}}
        options={options}
      />,
    );
    const optionElements = screen.getAllByRole("option");
    const values = optionElements.map((el) => (el as HTMLOptionElement).value);
    expect(values).not.toContain("invalid_value");
    expect(values).not.toContain("");
  });

  it("calls onChange with the selected option value", () => {
    const onChange = vi.fn();
    render(
      <SelectField
        label="Action"
        value="pause"
        onChange={onChange}
        options={options}
      />,
    );
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "skip_task" } });
    expect(onChange).toHaveBeenCalledWith("skip_task");
  });

  it("renders error inline", () => {
    render(
      <SelectField
        label="Action"
        value="pause"
        onChange={() => {}}
        options={options}
        error="Invalid"
      />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Invalid")).toBeTruthy();
  });
});

/* ---- ToggleField ------------------------------------------------------- */

describe("ToggleField", () => {
  it("renders a checkbox with the label", () => {
    render(<ToggleField label="Verbose" value={false} onChange={() => {}} />);
    const checkbox = screen.getByLabelText("Verbose");
    expect(checkbox).toBeTruthy();
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("calls onChange with the toggled value", () => {
    const onChange = vi.fn();
    render(<ToggleField label="Verbose" value={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Verbose"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders error inline", () => {
    render(
      <ToggleField label="Verbose" value={false} onChange={() => {}} error="Nope" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Nope")).toBeTruthy();
  });
});

/* ---- RecordEditor ----------------------------------------------------- */

describe("RecordEditor", () => {
  it("renders existing key-value pairs in order", () => {
    const value = { alpha: "1", beta: "2", gamma: "3" };
    render(<RecordEditor label="Env" value={value} onChange={() => {}} />);
    const inputs = document.querySelectorAll<HTMLInputElement>(".field__record-key");
    const keys = Array.from(inputs).map((el) => el.value);
    expect(keys).toEqual(["alpha", "beta", "gamma"]);
  });

  it("add preserves existing entries and appends", () => {
    const onChange = vi.fn();
    const value = { a: "1" };
    render(<RecordEditor label="Env" value={value} onChange={onChange} />);
    fireEvent.click(screen.getByText("+ Add entry"));
    const result = onChange.mock.calls[0][0] as Record<string, string>;
    expect(result).toHaveProperty("a", "1");
  });

  it("remove preserves order of remaining entries", () => {
    const onChange = vi.fn();
    const value = { a: "1", b: "2", c: "3" };
    render(<RecordEditor label="Env" value={value} onChange={onChange} />);
    const removeBtns = screen.getAllByLabelText(/^Remove /);
    fireEvent.click(removeBtns[1]); // remove "b"
    const result = onChange.mock.calls[0][0] as Record<string, string>;
    expect(Object.keys(result)).toEqual(["a", "c"]);
  });

  it("renders error inline", () => {
    render(
      <RecordEditor label="Env" value={{}} onChange={() => {}} error="Bad record" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Bad record")).toBeTruthy();
  });
});

/* ---- CommandListEditor ------------------------------------------------- */

describe("CommandListEditor", () => {
  it("renders commands in order", () => {
    render(
      <CommandListEditor label="Run" value={["npm test", "npm run lint"]} onChange={() => {}} />,
    );
    const inputs = document.querySelectorAll<HTMLInputElement>(".field__cmd-input");
    const cmds = Array.from(inputs).map((el) => el.value);
    expect(cmds).toEqual(["npm test", "npm run lint"]);
  });

  it("add appends a new empty entry", () => {
    const onChange = vi.fn();
    render(
      <CommandListEditor label="Run" value={["npm test"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("+ Add command"));
    expect(onChange).toHaveBeenCalledWith(["npm test", ""]);
  });

  it("remove preserves order of remaining entries", () => {
    const onChange = vi.fn();
    render(
      <CommandListEditor label="Run" value={["a", "b", "c"]} onChange={onChange} />,
    );
    const removeBtns = screen.getAllByLabelText(/^Remove command/);
    fireEvent.click(removeBtns[1]); // remove "b"
    expect(onChange).toHaveBeenCalledWith(["a", "c"]);
  });

  it("move up swaps with previous, preserving order", () => {
    const onChange = vi.fn();
    render(
      <CommandListEditor label="Run" value={["a", "b", "c"]} onChange={onChange} />,
    );
    const upBtns = screen.getAllByLabelText("Move up");
    fireEvent.click(upBtns[1]); // move "b" up
    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("move down swaps with next, preserving order", () => {
    const onChange = vi.fn();
    render(
      <CommandListEditor label="Run" value={["a", "b", "c"]} onChange={onChange} />,
    );
    const downBtns = screen.getAllByLabelText("Move down");
    fireEvent.click(downBtns[0]); // move "a" down
    expect(onChange).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("renders error inline", () => {
    render(
      <CommandListEditor label="Run" value={[]} onChange={() => {}} error="Need commands" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Need commands")).toBeTruthy();
  });

  /* ---- required (default) vs optional mode -------------------------------- */

  it("required mode: empty value renders one phantom row", () => {
    render(<CommandListEditor label="Run" value={[]} onChange={() => {}} />);
    expect(document.querySelectorAll(".field__cmd-input").length).toBe(1);
  });

  it("required mode: removing the last row floors at one empty row", () => {
    const onChange = vi.fn();
    render(<CommandListEditor label="Run" value={["only"]} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/^Remove command/));
    expect(onChange).toHaveBeenCalledWith([""]);
  });

  it("optional mode: empty value renders zero rows (no phantom)", () => {
    render(<CommandListEditor label="Run" value={[]} onChange={() => {}} optional />);
    expect(document.querySelectorAll(".field__cmd-input").length).toBe(0);
    // The "+ Add command" affordance is still present.
    expect(screen.getByText("+ Add command")).toBeTruthy();
  });

  it("optional mode: removing the last row reaches an empty list", () => {
    const onChange = vi.fn();
    render(<CommandListEditor label="Run" value={["only"]} onChange={onChange} optional />);
    fireEvent.click(screen.getByLabelText(/^Remove command/));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

/* ---- CSS tokens-only (zero color literals) ----------------------------- */

describe("fields.css", () => {
  it("contains no raw color literals — only tokens", () => {
    const css = readFileSync(
      resolve(import.meta.dirname, "fields.css"),
      "utf-8",
    );
    // Strip comments to avoid false positives from doc strings.
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    // Match hex (#abc, #aabbcc), rgb(), rgba(), hsl(), hsla(), oklch()
    // but not var(--…) references. currentColor is allowed.
    const colorLiteral =
      /#[0-9a-fA-F]{3,8}\b|(?<!-)\brgba?\s*\(|(?<!-)\bhsla?\s*\(|(?<!-)\boklch\s*\(/g;
    const matches = stripped.match(colorLiteral) ?? [];
    expect(matches).toEqual([]);
  });
});
