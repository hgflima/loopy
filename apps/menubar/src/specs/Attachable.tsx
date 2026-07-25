/**
 * Attachable — wraps any typing surface so the human can attach files (D9/D19).
 *
 * Three ways in, because people reach for whichever is nearest:
 *  - paste (⌘V) — screenshots land here, and the clipboard carries them as files
 *  - drag & drop onto the field, with an overlay while hovering
 *  - the 📎 button (a real `<input type="file">`)
 *
 * Nothing is uploaded here: attachments live in memory as {@link Attachment}s,
 * images carrying an object URL for a thumbnail that is **revoked on removal**.
 * The engine turns the picked files into `.loopy/attachments/` paths later
 * (D9/D19) — this component only collects them.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { Button } from "../ui";
import "./specs.css";

/** One attached file held in memory (pre-write). */
export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kind: "image" | "file";
  /** Object URL — only set for images, and revoked when the chip is removed. */
  readonly url?: string;
}

// A module-level counter keeps ids stable and pure — no Date.now()/Math.random().
let seq = 0;

function toAttachment(file: File): Attachment {
  const isImage = file.type.startsWith("image/");
  return {
    id: `att-${seq++}`,
    // A pasted screenshot arrives as "image.png" or with no name at all.
    name: file.name || (isImage ? "captura.png" : "arquivo"),
    size: file.size,
    kind: isImage ? "image" : "file",
    url: isImage ? URL.createObjectURL(file) : undefined,
  };
}

/** Bytes → a compact "5 B" / "2 KB" / "1.3 MB" label. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AttachableProps {
  /** The textarea/input to wrap. */
  readonly children: ReactNode;
  readonly attachments: readonly Attachment[];
  readonly onChange: (next: readonly Attachment[]) => void;
  readonly hint?: string;
}

export function Attachable({
  children,
  attachments,
  onChange,
  hint,
}: AttachableProps) {
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const add = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      onChange([...attachments, ...Array.from(files).map(toAttachment)]);
    },
    [attachments, onChange],
  );

  const remove = useCallback(
    (id: string) => {
      const gone = attachments.find((a) => a.id === id);
      // Free the blob the moment its chip leaves — object URLs leak otherwise.
      if (gone?.url) URL.revokeObjectURL(gone.url);
      onChange(attachments.filter((a) => a.id !== id));
    },
    [attachments, onChange],
  );

  return (
    <div
      className={`spec-attach${over ? " is-over" : ""}`}
      // Paste is captured on the wrapper so it works whether the caret is in
      // the field or the user just clicked the drop zone.
      onPaste={(e) => {
        if (e.clipboardData.files.length > 0) {
          e.preventDefault();
          add(e.clipboardData.files);
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        add(e.dataTransfer.files);
      }}
    >
      {children}

      <div className="spec-attach__bar">
        <Button
          variant="ghost"
          className="spec-attach__btn"
          onClick={() => fileInput.current?.click()}
          aria-label="Anexar arquivo"
        >
          📎 Anexar
        </Button>
        <span className="spec-attach__hint">
          {hint ?? "Cole (⌘V) ou arraste imagens, logs, prints…"}
        </span>
        <input
          ref={fileInput}
          className="spec-attach__input"
          type="file"
          multiple
          onChange={(e) => {
            add(e.target.files);
            // Re-picking the same file must still fire a change event.
            e.target.value = "";
          }}
        />
      </div>

      {attachments.length > 0 && (
        <ul className="spec-attach__list">
          {attachments.map((a) => (
            <li className="spec-chip" key={a.id}>
              {a.kind === "image" && a.url ? (
                <img className="spec-chip__thumb" src={a.url} alt="" />
              ) : (
                <span className="spec-chip__glyph" aria-hidden="true">
                  ▤
                </span>
              )}
              <span className="spec-chip__name" title={a.name}>
                {a.name}
              </span>
              <span className="spec-chip__size">{humanSize(a.size)}</span>
              <button
                type="button"
                className="spec-chip__x"
                onClick={() => remove(a.id)}
                aria-label={`Remover ${a.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {over && <div className="spec-attach__overlay">Solte para anexar</div>}
    </div>
  );
}
