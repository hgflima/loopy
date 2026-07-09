---
disable-model-invocation: true
description: Start spec-driven development — write a structured specification before writing code
---

Invoke the spec-driven-development skill.

Begin by understanding what the user wants to build. Ask clarifying questions about:
1. The objective and target users
2. Core features and acceptance criteria
3. Tech stack preferences and constraints
4. Known boundaries (what to always do, ask first about, and never do)

Then generate a structured spec covering all six core areas: objective, commands, project structure, code style, testing strategy, and boundaries.

Save the spec as SPEC.md in the project root and confirm with the user before proceeding.

Once the spec is saved and confirmed, immediately continue into the `/devy:refine` flow to stress-test it before any code is written: interview the user relentlessly about every aspect of the spec until you reach a shared understanding. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. Ask the questions one at a time, and for each provide your recommended answer. If a question can be answered by exploring the codebase, explore the codebase instead of asking.
