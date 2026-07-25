/**
 * WrittenFiles — the "what a Phase wrote" summary, shared by the gate and the
 * "Salvo" screen (C-0018).
 *
 * Both the {@link PhaseGate} (between Phases) and the Interview's `Saved` screen
 * (after the plan Phase) show the same thing: the Change dir and the files the
 * Phase produced, each with an optional "Abrir" affordance. This is that shared
 * block — the callers keep their own heading ("… gravada" vs "Salvo") and wrap
 * it in `spec-gate__summary`.
 */
import { Button } from "../ui";
import "./specs.css";

interface WrittenFilesProps {
  readonly changeDir: string | null;
  readonly files: readonly string[];
  /** When present, each file gets an "Abrir" affordance. */
  readonly onOpenFile?: (path: string) => void;
}

export function WrittenFiles({
  changeDir,
  files,
  onOpenFile,
}: WrittenFilesProps) {
  return (
    <>
      {changeDir && <p className="spec-gate__dir t-data">{changeDir}</p>}
      {files.length > 0 && (
        <ul className="spec-gate__files">
          {files.map((f) => (
            <li className="spec-gate__file" key={f}>
              <span className="spec-gate__file-name t-data">{f}</span>
              {onOpenFile && (
                <Button
                  variant="ghost"
                  className="spec-gate__open"
                  onClick={() => onOpenFile(f)}
                >
                  Abrir
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
