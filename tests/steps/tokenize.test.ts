import { describe, expect, it } from "vitest";
import {
  CommandParseError,
  displayCommand,
  tokenizeCommand,
} from "../../src/steps/tokenize";

describe("tokenizeCommand", () => {
  it("splits a plain command on whitespace, collapsing runs", () => {
    expect(tokenizeCommand("git   commit  -m")).toEqual([
      "git",
      "commit",
      "-m",
    ]);
  });

  it("keeps a double-quoted run with spaces as a single token", () => {
    expect(tokenizeCommand('git commit -m "a b c"')).toEqual([
      "git",
      "commit",
      "-m",
      "a b c",
    ]);
  });

  it("keeps a single-quoted run with spaces as a single token", () => {
    expect(tokenizeCommand("echo 'a b c'")).toEqual(["echo", "a b c"]);
  });

  it("consumes the quotes themselves (they are grouping, not content)", () => {
    expect(tokenizeCommand('-C ".worktrees/T-004"')).toEqual([
      "-C",
      ".worktrees/T-004",
    ]);
  });

  it("concatenates adjacent quoted and unquoted runs into one token", () => {
    expect(tokenizeCommand("a\"b\"c'd'e")).toEqual(["abcde"]);
  });

  it("preserves an empty quoted token", () => {
    expect(tokenizeCommand('foo "" bar')).toEqual(["foo", "", "bar"]);
  });

  // The heart of the fix: `$` is NOT special here — `${...}` / `$(...)` survive
  // as literal characters for the loopy resolver (or the program) to see.
  it("leaves ${...} literal inside double quotes (no expansion)", () => {
    expect(
      tokenizeCommand('commit -m "feat(${task.id}): ${task.title}"'),
    ).toEqual(["commit", "-m", "feat(${task.id}): ${task.title}"]);
  });

  it("leaves $(...) and backticks literal (no command substitution)", () => {
    expect(tokenizeCommand('echo "x $(rm -rf ~) `whoami` y"')).toEqual([
      "echo",
      "x $(rm -rf ~) `whoami` y",
    ]);
  });

  it("does not treat shell operators as separators (one command per entry)", () => {
    expect(tokenizeCommand("a;b|c&&d>e")).toEqual(["a;b|c&&d>e"]);
  });

  it("honors a backslash-escaped space outside quotes", () => {
    expect(tokenizeCommand("a\\ b")).toEqual(["a b"]);
  });

  it('escapes only " \\ $ ` inside double quotes; other backslashes stay literal', () => {
    expect(tokenizeCommand('"a\\"b\\\\c\\$d\\`e\\nf"')).toEqual([
      'a"b\\c$d`e\\nf',
    ]);
  });

  it("returns an empty argv for a blank line", () => {
    expect(tokenizeCommand("   ")).toEqual([]);
  });

  it("throws CommandParseError on an unterminated double quote", () => {
    expect(() => tokenizeCommand('git -m "oops')).toThrow(CommandParseError);
  });

  it("throws CommandParseError on an unterminated single quote", () => {
    expect(() => tokenizeCommand("echo 'oops")).toThrow(CommandParseError);
  });

  it("tokenizes the canonical loopy commit line correctly", () => {
    expect(
      tokenizeCommand(
        'git -C "${worktree.path}" commit -m "feat(${task.id}): ${task.title}"',
      ),
    ).toEqual([
      "git",
      "-C",
      "${worktree.path}",
      "commit",
      "-m",
      "feat(${task.id}): ${task.title}",
    ]);
  });
});

describe("displayCommand", () => {
  it("renders a plain argv space-joined", () => {
    expect(displayCommand(["git", "status"])).toBe("git status");
  });

  it("quotes tokens with spaces for readability", () => {
    expect(displayCommand(["git", "commit", "-m", "feat: a b"])).toBe(
      'git commit -m "feat: a b"',
    );
  });

  it("shows ${...} data plainly (only quoting because of the space)", () => {
    expect(displayCommand(["commit", "-m", "feat(T-004): x ${...}"])).toBe(
      'commit -m "feat(T-004): x ${...}"',
    );
  });

  it("renders an empty token as a pair of quotes", () => {
    expect(displayCommand(["a", "", "b"])).toBe('a "" b');
  });
});
