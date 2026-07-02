/**
 * React bindings from the framework-agnostic stores into Ink components. Both
 * hooks use `useSyncExternalStore`, which requires each `getSnapshot` to return a
 * **stable reference while unchanged** — a contract both sources honor: the
 * {@link Store} returns the same {@link StoreState} reference on a no-op dispatch,
 * and the {@link ApprovalController} returns the same head request until it
 * actually changes. That keeps re-renders bounded to real state transitions.
 */
import { useSyncExternalStore } from "react";
import type { ApprovalController, ApprovalRequest } from "./approval";
import type { Store, StoreState } from "./store";

/** Subscribe a component to the run store; re-renders on each state change. */
export function useStore(store: Store): StoreState {
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getState(),
  );
}

/** Subscribe to the current pending approval (or `undefined`). */
export function usePending(
  controller: ApprovalController,
): ApprovalRequest | undefined {
  return useSyncExternalStore(
    (onChange) => controller.subscribe(onChange),
    () => controller.pending(),
  );
}
