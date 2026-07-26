/**
 * ToolCallCard — one tool call, rendered from its accumulated `ToolCallState`.
 *
 * A DUMB component (spec Critério 1): it only paints the `ToolCallState` it is
 * handed. The status pill flips from pending → in_progress → completed/failed
 * on its own, because the parent hands a fresh state as each `tool_call_update`
 * merges in (R2/T-005) — the card holds no memory.
 *
 * Two colour channels, kept apart (C1):
 *  - the family HUE rides ONLY on the glyph stroke (`toolKindMeta().token` →
 *    `currentColor`), never a fill/border/pill — so the distinction survives
 *    colour-blindness (glyph × pill, not hue alone);
 *  - the STATUS keeps the fill, in the existing state hues, via `Pill`.
 *
 * `content`, `rawInput` and `rawOutput` are born inside CLOSED `<details>` whose
 * body is mounted LAZILY — the first time it is opened. So a huge payload is not
 * just unpainted, it is never built: `formatPayload`/`computeDiffHunks` do not
 * run until the user asks. The card also carries `content-visibility: auto`, so
 * an off-screen card costs no layout either (C3 mitigation on the render side —
 * the wire still carries everything, D6).
 */
import { memo, useMemo, useState } from "react";
import type {
  ToolCallState,
  ToolCallStatusName,
  ToolContentItem,
} from "loopy/tui/store";
import { toolKindMeta } from "./tool-kind";
import { Pill, type Tone } from "./StatusIndicator";
import { DiffView } from "./DiffView";
import { computeDiffHunks } from "./diff-hunks";
import "./ToolCallCard.css";

interface StatusMeta {
  readonly tone: Tone;
  readonly label: string;
  readonly pulse?: boolean;
  readonly hollow?: boolean;
}

/** The four tool-call statuses → a distinct state tone + pt-BR label. */
const STATUS_META: Readonly<Record<ToolCallStatusName, StatusMeta>> = {
  pending: { tone: "neutral", label: "Pendente", hollow: true },
  in_progress: { tone: "running", label: "Em progresso", pulse: true },
  completed: { tone: "done", label: "Concluído" },
  failed: { tone: "failed", label: "Falhou" },
};

/** Machine payload → a string to drop in a `<pre>`; never throws. */
function formatPayload(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * A diff content block. Isolated so `computeDiffHunks` can be memoized per
 * (oldText, newText) — the hunks are recomputed only when the diff actually
 * changes, not on every card re-render. Keeps DiffView pure: the card does the
 * one call into T-007, the view only paints.
 */
function DiffContent({
  path,
  oldText,
  newText,
}: {
  readonly path: string;
  readonly oldText?: string;
  readonly newText: string;
}) {
  const { hunks, truncated } = useMemo(
    () => computeDiffHunks(oldText, newText),
    [oldText, newText],
  );
  return (
    <div className="tool-card__diff">
      <div className="tool-card__diff-path t-data">{path}</div>
      <DiffView hunks={hunks} truncated={truncated} />
    </div>
  );
}

/** Render one `ToolContentItem` — diffs via DiffView, everything else verbatim. */
function ContentItem({ item }: { readonly item: ToolContentItem }) {
  switch (item.kind) {
    case "text":
      return <pre className="tool-card__text t-data">{item.text}</pre>;
    case "diff":
      return (
        <DiffContent
          path={item.path}
          oldText={item.oldText}
          newText={item.newText}
        />
      );
    case "terminal":
      return (
        <div className="tool-card__terminal t-data">
          terminal · {item.terminalId}
        </div>
      );
    case "raw":
      return (
        <pre className="tool-card__text t-data">
          {formatPayload(item.payload)}
        </pre>
      );
    default:
      // Defensive: the wire is untrusted, so an unmodelled kind degrades to raw
      // rather than crashing the card (D3 — nothing silently vanishes).
      return (
        <pre className="tool-card__text t-data">{formatPayload(item)}</pre>
      );
  }
}

/** A raw machine payload, formatted lazily — the `JSON.stringify` runs only when
 *  this component renders, i.e. when its enclosing `<details>` is opened. */
function PayloadBlock({ value }: { readonly value: unknown }) {
  return <pre className="tool-card__text t-data">{formatPayload(value)}</pre>;
}

/**
 * A closed-on-birth `<details>` whose body mounts only once opened. `children`
 * is a React element, so React does not render it (and the expensive work in it
 * — `formatPayload`, `computeDiffHunks` — does not run) until `opened` flips.
 * The latch stays true, so re-collapsing keeps the built content in place.
 *
 * jsdom flips `.open` on a summary click but never dispatches `toggle`; a real
 * browser does, which is what drives `onToggle` here (tests open explicitly).
 */
function Disclosure({
  label,
  children,
}: {
  readonly label: string;
  readonly children: () => React.ReactNode;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <details
      className="tool-card__disclosure"
      onToggle={(e) => {
        if (e.currentTarget.open) setOpened(true);
      }}
    >
      <summary className="tool-card__summary t-label">{label}</summary>
      {opened && children()}
    </details>
  );
}

export interface ToolCallCardProps {
  readonly call: ToolCallState;
}

export const ToolCallCard = memo(function ToolCallCard({
  call,
}: ToolCallCardProps) {
  const kindMeta = toolKindMeta(call.kind);
  const statusMeta = STATUS_META[call.status] ?? STATUS_META.pending;
  const Icon = kindMeta.Icon;

  return (
    <article className="tool-card">
      <header className="tool-card__header">
        <span
          className="tool-card__glyph"
          role="img"
          aria-label={kindMeta.label}
          style={{ color: kindMeta.token }}
        >
          <Icon />
        </span>
        <span className="tool-card__title t-body u-truncate">{call.title}</span>
        <Pill
          tone={statusMeta.tone}
          pulse={statusMeta.pulse}
          hollow={statusMeta.hollow}
        >
          {statusMeta.label}
        </Pill>
      </header>

      {call.locations.length > 0 && (
        <ul className="tool-card__locations t-data">
          {call.locations.map((loc, i) => (
            <li key={i} className="tool-card__location">
              {loc.path}
              {loc.line != null ? `:${loc.line}` : ""}
            </li>
          ))}
        </ul>
      )}

      {call.content.length > 0 && (
        <Disclosure label="Conteúdo">
          {() => (
            <div className="tool-card__content">
              {call.content.map((item, i) => (
                <ContentItem key={i} item={item} />
              ))}
            </div>
          )}
        </Disclosure>
      )}

      {call.rawInput !== undefined && (
        <Disclosure label="Entrada">
          {() => <PayloadBlock value={call.rawInput} />}
        </Disclosure>
      )}

      {call.rawOutput !== undefined && (
        <Disclosure label="Saída">
          {() => <PayloadBlock value={call.rawOutput} />}
        </Disclosure>
      )}
    </article>
  );
});
