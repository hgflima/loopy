# Routing Guide

## Use roadmap-task-flow when

- the user wants to note an idea quickly
- the user wants to add detail to a task
- the user wants to tag, filter, list, or reprioritize tasks
- the user is working at backlog level rather than graph level

## Use roadmap-planning-views when

- the user wants to pull a subset of tasks into a focused planning workspace
- the user wants to express or inspect dependencies between tasks
- the user wants to organize near-term versus later work in separate graphs
- the user wants to identify ready, blocked, root, leaf, or isolated work inside a planning graph

## Use roadmap-web-visualization when

- the user explicitly wants the browser workspace opened or closed
- the user wants to inspect roadmap state visually rather than only in chat
- the user asks for the kanban or graph interface

## Tie-breaker rule

If the request is about task lifecycle or backlog hygiene, route to `roadmap-task-flow`.

If the request is about selecting a task subset and arranging relationships inside a graph workspace, route to `roadmap-planning-views`.
