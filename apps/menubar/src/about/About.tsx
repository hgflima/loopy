/**
 * About — the dedicated "Sobre" window (C-0012, T-006).
 *
 * A small (~360×320) titlebar-overlay window: brand wordmark + product version
 * (from `getVersion()`) + PT tagline + GitHub/npm links (opened in the system
 * browser via `openUrl`) + author/copyright. Every colour/space/type value comes
 * from tokens.css — zero literals. The header is a `data-tauri-drag-region` with
 * a padding-top that clears the floating traffic lights (titlebar overlay).
 */
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
// Brand wordmark — dark text for light surfaces, white text for dark; the
// visible one is chosen by theme in About.css (mirrors App.css).
import logoOnLight from "../assets/loopy-wordmark-pink-dark.svg";
import logoOnDark from "../assets/loopy-wordmark-pink-white.svg";
import "./About.css";

/** Reuses the root package `description` as PT copy (spec §Decisões). */
const TAGLINE = "Motor de loop agêntico config-driven via ACP";
const AUTHOR = "Henrique Lima";
const GITHUB_URL = "https://github.com/hgflima/loopy";
const NPM_URL = "https://www.npmjs.com/package/@hgflima/loopy";

interface AboutLink {
  readonly label: string;
  readonly url: string;
}

const LINKS: readonly AboutLink[] = [
  { label: "GitHub", url: GITHUB_URL },
  { label: "npm", url: NPM_URL },
];

export function About() {
  const [version, setVersion] = useState<string | null>(null);

  // Version is single-sourced from the bundle (getVersion → tauri.conf version,
  // path-ref'd to the root package.json). Best-effort: a read failure just
  // leaves the line hidden rather than crashing the window.
  useEffect(() => {
    let active = true;
    getVersion()
      .then((v) => {
        if (active) setVersion(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Year via the clock — no magic number that ages (spec §Decisões).
  const year = new Date().getFullYear();

  return (
    <main className="about">
      <header className="about__drag" data-tauri-drag-region>
        <img
          className="about__logo about__logo--on-light"
          src={logoOnLight}
          alt="Loopy"
        />
        <img
          className="about__logo about__logo--on-dark"
          src={logoOnDark}
          alt="Loopy"
        />
        {version && <p className="about__version t-data">v{version}</p>}
      </header>

      <p className="about__tagline t-body">{TAGLINE}</p>

      <nav className="about__links" aria-label="Links do projeto">
        {LINKS.map((link) => (
          <button
            key={link.label}
            type="button"
            className="about__link"
            onClick={() => openUrl(link.url)}
          >
            {link.label}
          </button>
        ))}
      </nav>

      <footer className="about__credit t-label">
        © {year} {AUTHOR}
      </footer>
    </main>
  );
}
