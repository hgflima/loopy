import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./ui/tokens.css";
import "./ui/base.css";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Glance } from "./popover/Glance";
import { parseTransportLine } from "loopy/tui/transport";
import {
  applyLine,
  applySidecarExit,
  applySidecarStderr,
  dismissApproval,
  initialBridgeState,
} from "./state/store-bridge";
import { formatApprovalPayload } from "./panes/ApprovalPrompt";
import { shouldNotify } from "./state/notify";

// ---------------------------------------------------------------------------
// Mock NDJSON feed for dev:web (exercises the full applyLine pipeline)
// ---------------------------------------------------------------------------

const MOCK_FEED = [
  '{"frame":"control","control":"run_started"}',
  '{"frame":"event","type":"pipeline_declared","steps":[{"id":"implement","type":"agent"},{"id":"test","type":"checks"},{"id":"merge","type":"approval"}]}',
  '{"frame":"event","type":"edges_set","edges":[["T-001","T-002"],["T-001","T-003"]]}',
  '{"frame":"event","type":"task_registered","taskId":"T-001","title":"Setup exports"}',
  '{"frame":"event","type":"task_registered","taskId":"T-002","title":"Transport layer","status":"blocked"}',
  '{"frame":"event","type":"task_registered","taskId":"T-003","title":"Store bridge","status":"blocked"}',
  '{"frame":"event","type":"task_started","taskId":"T-001"}',
  '{"frame":"event","type":"step_started","taskId":"T-001","stepId":"implement","stepType":"agent"}',
  '{"frame":"event","type":"attempt_started","taskId":"T-001","stepId":"implement","attempt":1,"maxAttempts":3}',
  '{"frame":"event","type":"stream_chunk","taskId":"T-001","text":"Implementing subpath exports..."}',
  '{"frame":"event","type":"step_finished","taskId":"T-001","stepId":"implement","ok":true}',
  '{"frame":"event","type":"step_started","taskId":"T-001","stepId":"test","stepType":"checks"}',
  '{"frame":"event","type":"check_started","taskId":"T-001","stepId":"test","name":"typecheck"}',
  '{"frame":"event","type":"check_finished","taskId":"T-001","stepId":"test","name":"typecheck","ok":true}',
  '{"frame":"event","type":"check_started","taskId":"T-001","stepId":"test","name":"lint"}',
  '{"frame":"event","type":"check_finished","taskId":"T-001","stepId":"test","name":"lint","ok":true}',
  '{"frame":"event","type":"step_finished","taskId":"T-001","stepId":"test","ok":true}',
  '{"frame":"event","type":"step_started","taskId":"T-001","stepId":"merge","stepType":"approval"}',
  '{"frame":"control","control":"approval_requested","requestId":"req-1","taskId":"T-001","stepId":"merge","summary":"Merge T-001 into main?"}',
  '{"frame":"control","control":"approval_requested","requestId":"req-2","taskId":"T-002","stepId":"merge","summary":"Merge T-002 into main?"}',
  '{"frame":"event","type":"step_finished","taskId":"T-001","stepId":"merge","ok":true}',
  '{"frame":"event","type":"task_finished","taskId":"T-001","status":"done"}',
  '{"frame":"event","type":"task_started","taskId":"T-002"}',
  '{"frame":"event","type":"step_started","taskId":"T-002","stepId":"implement","stepType":"agent"}',
  '{"frame":"event","type":"stream_chunk","taskId":"T-002","text":"Building transport layer..."}',
  '{"frame":"control","control":"run_finished","result":{"success":true,"tasksCompleted":1}}',
];

const FEED_INTERVAL_MS = 300;

// ---------------------------------------------------------------------------
// Notification dispatch (T-017 — signal discipline, best-effort)
// ---------------------------------------------------------------------------

function dispatchNotification(line: string): void {
  const parsed = parseTransportLine(line);
  if (!parsed.ok || parsed.frame === "command") return;
  const input = parsed.frame === "control" ? parsed.control : parsed.event;
  const notif = shouldNotify(input);
  if (!notif) return;
  import("@tauri-apps/plugin-notification")
    .then(({ sendNotification }) => sendNotification(notif))
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Runtime detection (module-level, computed once)
// ---------------------------------------------------------------------------

const IS_TAURI = isTauri();
const IS_POPOVER = IS_TAURI && getCurrentWindow().label === "popover";

// ---------------------------------------------------------------------------
// Crash capture net — survives the webview dying (debug aid)
// ---------------------------------------------------------------------------
// The main window "vanishing back to the popover" mid-Run has two opposite
// causes with opposite fixes: a native hide()/close of the window, vs. a React
// render throw that unmounts the tree (blank screen). Without a net, either one
// leaves no trace. This routes every uncaught error to the Rust process stderr
// (which outlives the webview) and renders the stack instead of dying silently.

function logWebviewError(
  source: string,
  message: string,
  stack?: string,
  componentStack?: string,
): void {
  // Console first — visible in DevTools with "Preserve Log" on.
  console.error(`[webview-error:${source}]`, message, stack ?? "", componentStack ?? "");
  // Then persist to the backend: the Rust stderr survives the webview crashing.
  if (IS_TAURI) {
    invoke("log_error", {
      source,
      message,
      stack: stack ?? "",
      componentStack: componentStack ?? "",
    }).catch(() => {});
  }
}

// Global handlers — installed once, before render, so nothing slips through.
window.addEventListener("error", (e) => {
  logWebviewError("window.onerror", e.message, e.error?.stack);
});
window.addEventListener("unhandledrejection", (e) => {
  const reason = e.reason;
  logWebviewError(
    "unhandledrejection",
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : undefined,
  );
});

interface ErrorBoundaryProps {
  label: string;
  children: React.ReactNode;
}
interface ErrorBoundaryState {
  error: Error | null;
}

/** Top-level boundary: renders the stack instead of unmounting to a blank window. */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    logWebviewError(
      `react:${this.props.label}`,
      error.message,
      error.stack,
      info.componentStack ?? undefined,
    );
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      return (
        <div
          role="alert"
          style={{
            padding: 16,
            font: "12px/1.5 ui-monospace, monospace",
            color: "#ff9a9a",
            background: "#1a1114",
            height: "100vh",
            overflow: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>Render crashed ({this.props.label})</strong>
          {`\n\n${error.message}\n\n${error.stack ?? ""}`}
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Root — manages BridgeState, routes by window label
// ---------------------------------------------------------------------------

function Root() {
  const [state, setState] = useState(initialBridgeState);
  const prevApprovalCount = useRef(0);
  const [yesFlag, setYesFlag] = useState(false);

  // ----------------------------------------------------------
  // LaunchConfig callback (reset state + track --yes flag)
  // ----------------------------------------------------------

  const handleStartRun = useCallback((yes: boolean) => {
    setState(initialBridgeState);
    setYesFlag(yes);
  }, []);

  // ----------------------------------------------------------
  // Approval decision callback (T-016 — the only mutation surface)
  // ----------------------------------------------------------

  const handleApprovalDecision = useCallback(
    async (requestId: string, approved: boolean) => {
      if (IS_TAURI) {
        const payload = formatApprovalPayload(requestId, approved);
        await invoke("send_command", { payload });
      }
      // Optimistic removal — motor doesn't ack, mirrors TUI's FIFO settle
      setState((prev) => dismissApproval(prev, requestId));
    },
    [],
  );

  // ----------------------------------------------------------
  // Tray badge ⚠ + bring-to-front on new approval (T-016)
  // ----------------------------------------------------------

  useEffect(() => {
    if (!IS_TAURI || IS_POPOVER) return;
    const count = state.ui.pendingApprovals.length;

    // Empty title when idle/running (icon-only); "⚠ N" when approvals pending
    const title = count === 0 ? "" : count === 1 ? "⚠" : `⚠ ${count}`;
    invoke("update_tray_title", { title }).catch(() => {});

    // Surface window when a new approval arrives
    if (count > prevApprovalCount.current && count > 0) {
      invoke("bring_to_front").catch(() => {});
    }
    prevApprovalCount.current = count;
  }, [state.ui.pendingApprovals.length]);

  // ----------------------------------------------------------
  // NDJSON feed (sidecar or mock)
  // ----------------------------------------------------------

  useEffect(() => {
    if (!IS_TAURI) {
      // dev:web: mock NDJSON feed
      let i = 0;
      const id = setInterval(() => {
        if (i >= MOCK_FEED.length) {
          clearInterval(id);
          return;
        }
        setState((prev) => applyLine(prev, MOCK_FEED[i++]!));
      }, FEED_INTERVAL_MS);
      return () => clearInterval(id);
    }

    // Tauri: listen to sidecar events
    const unLine = listen<string>("sidecar://line", (event) => {
      setState((prev) => applyLine(prev, event.payload));
      dispatchNotification(event.payload);
    });

    // stderr → rolling tail (surfaced by the Banner on failure)
    const unStderr = listen<string>("sidecar://stderr", (event) => {
      setState((prev) => applySidecarStderr(prev, event.payload));
    });

    // exit → classify start-fail vs death-mid-run (T-018 Banner)
    const unExit = listen<number>("sidecar://exit", (event) => {
      setState((prev) => applySidecarExit(prev, event.payload));
    });

    return () => {
      unLine.then((fn) => fn());
      unStderr.then((fn) => fn());
      unExit.then((fn) => fn());
    };
  }, []);

  return IS_POPOVER ? (
    <Glance state={state} yesFlag={yesFlag} />
  ) : (
    <App state={state} onStartRun={handleStartRun} onApprovalDecision={handleApprovalDecision} />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary label={IS_POPOVER ? "popover" : "main"}>
      <Root />
    </ErrorBoundary>
  </React.StrictMode>,
);
