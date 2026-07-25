/**
 * PROTOTYPE — throwaway. Floating variant switcher.
 *
 * Deliberately NOT styled like the app: high-contrast pill so it reads as
 * scaffolding, not as part of the design being judged. Hidden outside dev.
 */
import { useEffect } from "react";

export interface VariantMeta {
  readonly key: string;
  readonly name: string;
}

interface Props {
  readonly variants: readonly VariantMeta[];
  readonly current: string;
  readonly onChange: (key: string) => void;
}

export function PrototypeSwitcher({ variants, current, onChange }: Props) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      ) {
        return;
      }
      const delta = e.key === "ArrowRight" ? 1 : -1;
      const next = (index + delta + variants.length) % variants.length;
      onChange(variants[next]!.key);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, variants, onChange]);

  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV !== true)
    return null;

  const cycle = (delta: number) =>
    onChange(
      variants[(index + delta + variants.length) % variants.length]!.key,
    );

  return (
    <div
      className="proto-switcher"
      role="group"
      aria-label="Variante do protótipo"
    >
      <button
        className="proto-switcher__arrow"
        onClick={() => cycle(-1)}
        aria-label="Variante anterior"
      >
        ←
      </button>
      <span className="proto-switcher__label">
        <strong>{variants[index]!.key}</strong> — {variants[index]!.name}
      </span>
      <button
        className="proto-switcher__arrow"
        onClick={() => cycle(1)}
        aria-label="Próxima variante"
      >
        →
      </button>
    </div>
  );
}
