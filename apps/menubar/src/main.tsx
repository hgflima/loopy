import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { Glance } from "./popover/Glance";
import { applyLine, initialBridgeState } from "./state/store-bridge";

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
  '{"frame":"event","type":"step_finished","taskId":"T-001","stepId":"merge","ok":true}',
  '{"frame":"event","type":"task_finished","taskId":"T-001","status":"done"}',
  '{"frame":"event","type":"task_started","taskId":"T-002"}',
  '{"frame":"event","type":"step_started","taskId":"T-002","stepId":"implement","stepType":"agent"}',
  '{"frame":"event","type":"stream_chunk","taskId":"T-002","text":"Building transport layer..."}',
  '{"frame":"control","control":"run_finished","result":{"success":true,"tasksCompleted":1}}',
];

const FEED_INTERVAL_MS = 300;

// ---------------------------------------------------------------------------
// Runtime detection (module-level, computed once)
// ---------------------------------------------------------------------------

const IS_TAURI = isTauri();
const IS_POPOVER = IS_TAURI && getCurrentWindow().label === "popover";

// ---------------------------------------------------------------------------
// Root — manages BridgeState, routes by window label
// ---------------------------------------------------------------------------

function Root() {
  const [state, setState] = useState(initialBridgeState);

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
    });

    const unExit = listen<number>("sidecar://exit", () => {
      // T-018 will add banner handling for sidecar failures
    });

    return () => {
      unLine.then((fn) => fn());
      unExit.then((fn) => fn());
    };
  }, []);

  return IS_POPOVER ? <Glance state={state} /> : <App state={state} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
