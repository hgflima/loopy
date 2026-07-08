import { isTauri } from "@tauri-apps/api/core";
import type { BridgeState } from "./state/store-bridge";
import { StreamPanel } from "./panes/StreamPanel";
import { Banner } from "./panes/Banner";

interface AppProps {
  state: BridgeState;
}

function App({ state }: AppProps) {
  const { store, ui } = state;
  const isStartFail = ui.sidecarFailure?.type === "start-fail";

  return (
    <main>
      <h1>Loopy</h1>
      <Banner ui={ui} />
      {isStartFail ? (
        // Start-fail: return to LaunchConfig (idle view)
        <p>Configure a run to get started.</p>
      ) : (
        <>
          <p>Runtime: {isTauri() ? "Tauri" : "Web"}</p>
          <p>Run: {ui.runStatus}</p>
          <p>Tasks: {store.tasks.length}</p>
          {store.tasks.map((t) => (
            <div key={t.id}>
              <strong>{t.id}</strong> — {t.title} [{t.status}]
            </div>
          ))}
          {ui.pendingApprovals.length > 0 && (
            <p>Pending approvals: {ui.pendingApprovals.length}</p>
          )}
          <StreamPanel store={store} />
        </>
      )}
    </main>
  );
}

export default App;
