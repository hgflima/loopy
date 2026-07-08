import { isTauri } from "@tauri-apps/api/core";

const IS_TAURI = isTauri();

function App() {
  return (
    <main>
      <h1>Loopy</h1>
      <p>Runtime: {IS_TAURI ? "Tauri" : "Web"}</p>
    </main>
  );
}

export default App;
