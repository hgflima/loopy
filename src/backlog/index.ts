/**
 * Public barrel for `loopy/backlog` — browser-safe surface only.
 *
 * Re-exports the pure, I/O-free API: parse and options builder.
 * **Never** re-exports `loadBacklog` or `markDoneInFile` (use `node:fs`).
 */
export { parseBacklog, backlogOptionsFrom } from "./todo";
export type { BacklogOptions } from "./todo";
export type { Task } from "../types";
