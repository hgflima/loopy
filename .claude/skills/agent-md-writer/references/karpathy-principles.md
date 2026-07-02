# Karpathy-Inspired Agent Behavior Principles

This file is an internal reference for the `agent-md-writer` skill. It is **not** copied into the user's project. When generating `CLAUDE.md` or `AGENTS.md`, the skill pastes the [Inline Snippet](#inline-snippet) section below into the file under a `## Agent Behavior` heading.

## Why These Principles

LLMs coding in agentic loops have four recurring failure modes, first articulated by Andrej Karpathy ([original post](https://x.com/karpathy/status/2015883857489522876)):

> "The models make wrong assumptions on your behalf and just run along with them without checking. They don't manage their confusion, don't seek clarifications, don't surface inconsistencies, don't present tradeoffs, don't push back when they should."
>
> "They really like to overcomplicate code and APIs, bloat abstractions, don't clean up dead code... implement a bloated construction over 1000 lines when 100 would do."
>
> "They still sometimes change/remove comments and code they don't sufficiently understand as side effects, even if orthogonal to the task."
>
> "LLMs are exceptionally good at looping until they meet specific goals... Don't tell it what to do, give it success criteria and watch it go."

Four principles directly map to these failure modes:

| Principle | Addresses |
|---|---|
| **Think Before Coding** | Wrong assumptions, hidden confusion, missing tradeoffs |
| **Simplicity First** | Overcomplication, bloated abstractions, speculative code |
| **Surgical Changes** | Orthogonal edits, touching code unrelated to the task |
| **Goal-Driven Execution** | Weak success criteria, inability to self-verify |

These are *behavior* instructions, not *mechanics*. A linter catches style. A type-checker catches type errors. Nothing in the toolchain catches an agent silently picking an interpretation, overengineering, refactoring adjacent code, or failing to define what "done" means. Those are the holes these principles fill — and every onboarding file should patch them.

## The Four Principles (Full Text)

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State assumptions explicitly. If uncertain, ask rather than guess.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

**The test:** Would a reviewer know from the reply what the model *assumed*? If not, the assumption was hidden.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite.

**The test:** Would a senior engineer say this is overcomplicated? If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that *your* changes made unused.
- Don't remove pre-existing dead code unless asked.

**The test:** Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

| Instead of... | Transform to... |
|---|---|
| "Add validation" | "Write tests for invalid inputs, then make them pass" |
| "Fix the bug" | "Write a test that reproduces it, then make it pass" |
| "Refactor X" | "Ensure tests pass before and after" |

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

**The test:** Strong criteria let the agent loop independently. Weak criteria ("make it work") require constant clarification.

## Inline Snippet

Paste this block (verbatim) into the generated `CLAUDE.md` or `AGENTS.md` under a `## Agent Behavior` heading. It is intentionally compressed — the full rationale lives in this reference file, not in the user's onboarding file.

```markdown
## Agent Behavior

1. **Think before coding** — state assumptions, ask when ambiguous, surface tradeoffs. Don't pick silently between interpretations.
2. **Simplicity first** — minimum code that solves the problem. No speculative abstractions, no unrequested flexibility.
3. **Surgical changes** — touch only what's required. Don't refactor adjacent code. Match existing style.
4. **Goal-driven execution** — define success criteria, loop until verified. Every changed line traces to the request.
```

Six lines total. ~40 instructions compressed to 4 principles — each one a lever against a specific LLM failure mode.

## When to Omit or Adapt

- **Trivial repos** (single-file scripts, throwaway prototypes): still include — it's cheap and the benefit compounds.
- **Repos with existing behavior guides** (e.g., custom code of conduct for the agent): audit for overlap before adding. If the existing guide covers the same ground, skip; if it's weaker, replace.
- **Don't duplicate.** If the principles are already present (under any heading), leave them alone.

## Attribution

The original formulation is from **Forrest Chang's** repo [`forrestchang/andrej-karpathy-skills`](https://github.com/forrestchang/andrej-karpathy-skills), MIT-licensed. The underlying observations are from Andrej Karpathy's post linked at the top of this file.

When the skill audits an existing `CLAUDE.md` / `AGENTS.md` and finds no "Agent Behavior" section, it proposes adding this snippet with attribution noted in the PR description — not in the file itself (the file stays terse).
