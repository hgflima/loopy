/**
 * Handoff — the bug/debt terminal of the Interview (D4/D24).
 *
 * The feature trail produces files; the bug/debt trail deliberately does not.
 * It ends here: a ready-to-run `/devy:debug <demand>` command, copyable in one
 * click, plus the context gathered on the way. **Nothing is written** — the
 * "volta do debug" (investigation → todo.md) is out of the v1 (D4), so this
 * hands off to a terminal instead of pretending to author a Change.
 */
import { useRef, useState } from "react";
import { Button } from "../ui";
import type { Track } from "./interview-state";
import "./specs.css";

interface ContextItem {
  readonly label: string;
  readonly value: string;
}

interface HandoffProps {
  /** The trail that reached here — `bug` or `debt` (never `feature`). */
  readonly track: Track;
  /** The free-text demand from the `describe` stage. */
  readonly demand: string;
  /** Context gathered along the trail (repro, evidence…), shown as a list. */
  readonly context?: readonly ContextItem[];
}

export function Handoff({ demand, context = [] }: HandoffProps) {
  const command = `/devy:debug ${demand.trim()}`;
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  async function copy() {
    // `navigator.clipboard` is absent in insecure contexts — copying is a
    // convenience, never a hard dependency, so a missing API is a silent no-op.
    try {
      await navigator.clipboard?.writeText(command);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard denied — the command is still visible to copy by hand */
    }
  }

  return (
    <div className="spec-handoff">
      <div className="spec-handoff__cmd-row">
        <pre className="spec-handoff__cmd t-data">{command}</pre>
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copiado ✓" : "Copiar"}
        </Button>
      </div>

      {context.length > 0 && (
        <dl className="spec-handoff__ctx">
          {context.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="spec-handoff__note">
        Nenhum arquivo é criado agora. Se a investigação virar trabalho, ela
        volta para a trilha da feature e aí sim vira spec/plan/todo.
      </p>
    </div>
  );
}
