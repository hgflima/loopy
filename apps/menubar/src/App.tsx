import { isTauri } from "@tauri-apps/api/core";
import type { BridgeState } from "./state/store-bridge";

interface AppProps {
  state: BridgeState;
}

function App({ state }: AppProps) {
  const { store, ui } = state;

  return (
    <main>
      <h1>Loopy</h1>
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
    </main>
  );
}

export default App;
