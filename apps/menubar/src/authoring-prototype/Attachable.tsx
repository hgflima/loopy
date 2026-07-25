/**
 * PROTOTYPE — throwaway. Wraps any typing surface so the user can attach files.
 *
 * Three ways in, because people reach for whichever is nearest:
 *  - paste (⌘V) — screenshots land here, and the clipboard carries them as files
 *  - drag & drop onto the field
 *  - the 📎 button (a real <input type="file">)
 *
 * Nothing is uploaded: attachments live in memory as object URLs and are
 * revoked on removal. Images get a thumbnail; everything else gets a chip.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly kind: "image" | "file";
  /** Object URL — only set for images, and revoked when removed. */
  readonly url?: string;
}

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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  /** The textarea/input to wrap. */
  readonly children: ReactNode;
  readonly attachments: readonly Attachment[];
  readonly onChange: (next: readonly Attachment[]) => void;
  readonly hint?: string;
}

export function Attachable({ children, attachments, onChange, hint }: Props) {
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
      if (gone?.url) URL.revokeObjectURL(gone.url);
      onChange(attachments.filter((a) => a.id !== id));
    },
    [attachments, onChange],
  );

  return (
    <div
      className={"pf-attach" + (over ? " is-over" : "")}
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

      <div className="pf-attach__bar">
        <button
          type="button"
          className="pf-attach__btn"
          onClick={() => fileInput.current?.click()}
          aria-label="Anexar arquivo"
        >
          📎 Anexar
        </button>
        <span className="pf-attach__hint">
          {hint ?? "Cole (⌘V) ou arraste imagens, logs, prints…"}
        </span>
        <input
          ref={fileInput}
          className="pf-attach__input"
          type="file"
          multiple
          onChange={(e) => {
            add(e.target.files);
            e.target.value = ""; // re-picking the same file must still fire
          }}
        />
      </div>

      {attachments.length > 0 && (
        <ul className="pf-attach__list">
          {attachments.map((a) => (
            <li className="pf-chip" key={a.id}>
              {a.kind === "image" && a.url ? (
                <img className="pf-chip__thumb" src={a.url} alt="" />
              ) : (
                <span className="pf-chip__glyph" aria-hidden="true">
                  ▤
                </span>
              )}
              <span className="pf-chip__name" title={a.name}>
                {a.name}
              </span>
              <span className="pf-chip__size">{humanSize(a.size)}</span>
              <button
                type="button"
                className="pf-chip__x"
                onClick={() => remove(a.id)}
                aria-label={`Remover ${a.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {over && <div className="pf-attach__overlay">Solte para anexar</div>}
    </div>
  );
}
