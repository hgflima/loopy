#!/usr/bin/env node
/**
 * Linux: registra o app de dev no launcher do desktop
 * (`~/.local/share/applications/loopy-menubar.desktop`).
 *
 * Sem isso o GNOME (sobretudo no Wayland) mostra a janela sem ícone na lista de
 * apps abertos: ele casa a janela com um `.desktop` pelo app_id, que para o
 * binário de dev é `loopy-menubar` (o nome do executável — `StartupWMClass`).
 * O `.deb`/`.AppImage` do `tauri build` trazem o próprio `.desktop`; este script
 * é só para o `tauri dev`. O `Exec` sobe o app via `npm run dev`, então o ícone
 * também serve de atalho. Ver docs/how-to/plataformas.md.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") {
  console.error("install-linux-desktop: só se aplica ao Linux.");
  process.exit(1);
}

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appDir, "..", "..");
const icon = join(appDir, "src-tauri", "icons", "128x128@2x.png");
const dataHome =
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
const target = join(dataHome, "applications", "loopy-menubar.desktop");
// Absolute path: a launcher started by the desktop has no shell PATH (mise
// lives in ~/.local/bin). `Exec` takes no shell syntax, hence `Path=` for cwd.
const mise = execFileSync("sh", ["-c", "command -v mise"], {
  encoding: "utf8",
}).trim();

const entry = `[Desktop Entry]
Type=Application
Name=Loopy (dev)
Comment=GUI do loopy — motor de loop agêntico
Path=${repoRoot}
Exec=${mise} exec -- npm run dev -w apps/menubar
Icon=${icon}
Terminal=false
Categories=Development;
StartupWMClass=loopy-menubar
`;

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, entry);
console.log(`install-linux-desktop: ${target}`);
