/**
 * Approval helpers — pure data extraction for the approval gate (AD-6).
 *
 * The full-screen modal was removed in T-012; the gate now lives inside
 * {@link CardDetail}. These helpers remain here so existing imports
 * (`approval.test.ts`, `main.tsx`) keep working without churn.
 *
 * - {@link headApproval} — extracts the FIFO queue head
 * - {@link escalationCost} — human-readable consequence of rejection
 * - {@link formatApprovalPayload} — NDJSON payload for the motor
 */

import type { UIState, ApprovalRequest } from "../state/store-bridge";

// ---------------------------------------------------------------------------
// Pure data extraction (AD-6)
// ---------------------------------------------------------------------------

/** Return the head of the pending-approvals FIFO queue, or `undefined`. */
export function headApproval(ui: UIState): ApprovalRequest | undefined {
  return ui.pendingApprovals[0];
}

/** Human-readable cost of rejecting the approval (= escalation). */
export function escalationCost(): string {
  return "Task será escalonada (pause / skip / abort conforme on_fail)";
}

/**
 * Format an `approval_decision` command as NDJSON for the motor's stdin.
 *
 * Must match `parseApprovalDecision` in `src/tui/approval.ts`:
 * `{ "type": "approval_decision", "requestId": "…", "approved": true|false }`
 */
export function formatApprovalPayload(
  requestId: string,
  approved: boolean,
): string {
  return JSON.stringify({ type: "approval_decision", requestId, approved });
}
