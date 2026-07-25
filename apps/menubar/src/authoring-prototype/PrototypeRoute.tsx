/**
 * PROTOTYPE — throwaway. Mounted only when the URL has `?proto=authoring`.
 *
 * Question this answers: **como criar spec/plan de forma "smooth"?** Wizard,
 * chat, ou outra coisa. Four structurally different answers on one route,
 * switchable via `?variant=` and the floating bar.
 *
 * Hosted inside the real app shell (same header, same tokens, same density)
 * so the variants are judged against the app they'd live in, not in a vacuum.
 * Nothing here writes to disk and no agent is called — every "agent" reply is
 * canned in `fixtures.ts`.
 */
import { useState, useCallback } from "react";
import { Pill } from "../ui";
import { PrototypeSwitcher, type VariantMeta } from "./PrototypeSwitcher";
import { VariantA_Wizard } from "./VariantA_Wizard";
import { VariantB_Chat } from "./VariantB_Chat";
import { VariantC_Copilot } from "./VariantC_Copilot";
import { VariantD_OneAtATime } from "./VariantD_OneAtATime";
import { VariantE_DevyFlow } from "./VariantE_DevyFlow";
import logoOnLight from "../assets/loopy-wordmark-pink-dark.svg";
import logoOnDark from "../assets/loopy-wordmark-pink-white.svg";
import "../App.css";
import "./prototype.css";

const VARIANTS: readonly VariantMeta[] = [
  { key: "A", name: "Wizard de etapas" },
  { key: "B", name: "Chat + artefato ao vivo" },
  { key: "C", name: "Documento primeiro, agente na margem" },
  { key: "D", name: "Uma pergunta por vez" },
  { key: "E", name: "Roteiro devy (espinha do D)" },
];

function readVariant(): string {
  const v = new URLSearchParams(window.location.search)
    .get("variant")
    ?.toUpperCase();
  return VARIANTS.some((x) => x.key === v) ? v! : "A";
}

export function PrototypeRoute() {
  const [variant, setVariant] = useState(readVariant);
  const [dir, setDir] = useState("");

  const change = useCallback((key: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", key);
    window.history.replaceState(null, "", url);
    setVariant(key);
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header__brand">
          <img
            className="app-header__logo app-header__logo--on-light"
            src={logoOnLight}
            alt="Loopy"
          />
          <img
            className="app-header__logo app-header__logo--on-dark"
            src={logoOnDark}
            alt="Loopy"
          />
          <Pill tone="neutral">Idle</Pill>
        </div>
        <div className="app-header__dir" data-testid="dir-picker">
          {/* In E the directory is chosen inside the flow, so the header
              follows it instead of being a second, competing picker. */}
          <input
            className="app-header__dir-input"
            type="text"
            value={variant === "E" ? dir : "/Users/você/dev/algum-projeto"}
            placeholder="nenhuma pasta escolhida"
            readOnly
            spellCheck={false}
            aria-label="Diretório-alvo"
          />
          <button className="pa-btn pa-btn--ghost" disabled>
            Escolher…
          </button>
          <button
            className="pa-btn pa-btn--primary"
            disabled
            title="Sem backlog ainda"
          >
            Iniciar
          </button>
        </div>
      </header>

      <div className="proto-stage">
        {/* B e C usam a altura inteira (split / canvas) — a intro só cabe em A e D. */}
        {(variant === "A" || variant === "D") && (
          <div className="proto-stage__intro">
            <h1 className="proto-stage__title">
              Este projeto ainda não tem um backlog
            </h1>
            <p className="proto-stage__sub">
              O loopy precisa de um <code>spec.md</code>, um{" "}
              <code>plan.md</code> e um <code>todo.md</code> pra ter o que
              rodar. Vamos escrever?
            </p>
          </div>
        )}

        {variant === "A" && <VariantA_Wizard />}
        {variant === "B" && <VariantB_Chat />}
        {variant === "C" && <VariantC_Copilot />}
        {variant === "D" && <VariantD_OneAtATime />}
        {variant === "E" && <VariantE_DevyFlow onProjectChange={setDir} />}
      </div>

      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        onChange={change}
      />
    </main>
  );
}
