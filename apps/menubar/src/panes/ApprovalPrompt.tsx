/**
 * ApprovalPrompt — the **only** mutation surface in the app (AD-1).
 *
 * Renders the **head** of the FIFO approval queue (T-016): context
 * (task · step · summary) plus the cost of rejecting (escalation).
 * Two explicit buttons — Approve / Reject — send an `approval_decision`
 * command to the motor via `send_command` (stdin).
 *
 * Pure data helpers are exported for testing (AD-6):
 * - {@link headApproval} — extracts the queue head
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

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

interface ApprovalPromptProps {
  readonly request: ApprovalRequest;
  readonly queueSize: number;
  readonly onDecision: (requestId: string, approved: boolean) => void;
}

export function ApprovalPrompt({
  request,
  queueSize,
  onDecision,
}: ApprovalPromptProps) {
  return (
    <div
      className="approval-prompt"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.7)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "#1a1a2e",
          border: "1px solid #333",
          borderRadius: 8,
          padding: "24px 28px",
          maxWidth: 480,
          width: "90%",
          color: "#ccc",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 20 }}>⚠</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#fff" }}>
            Aprovação necessária
          </span>
          {queueSize > 1 && (
            <span style={{ fontSize: 11, color: "#888", marginLeft: "auto" }}>
              +{queueSize - 1} na fila
            </span>
          )}
        </div>

        {/* Context: task · step */}
        <div
          style={{
            display: "flex",
            gap: 8,
            fontSize: 12,
            color: "#888",
            marginBottom: 8,
          }}
        >
          <span style={{ color: "cyan" }}>{request.taskId}</span>
          <span>·</span>
          <span>{request.stepId}</span>
        </div>

        {/* Summary (the interpolated prompt) */}
        <p style={{ fontSize: 14, lineHeight: 1.5, margin: "0 0 16px" }}>
          {request.summary}
        </p>

        {/* Cost of rejection */}
        <p
          style={{
            fontSize: 11,
            color: "#e53e3e",
            margin: "0 0 20px",
            padding: "8px 10px",
            background: "rgba(229, 62, 62, 0.1)",
            borderRadius: 4,
          }}
        >
          Custo de reprovar: {escalationCost()}
        </p>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => onDecision(request.requestId, false)}
            style={{
              flex: 1,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #e53e3e",
              background: "transparent",
              color: "#e53e3e",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reprovar
          </button>
          <button
            onClick={() => onDecision(request.requestId, true)}
            style={{
              flex: 1,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #38a169",
              background: "#38a169",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Aprovar
          </button>
        </div>
      </div>
    </div>
  );
}
