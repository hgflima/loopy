/**
 * One named check's live status (`✓ typecheck` / `✗ test` / `… lint`), colored by
 * outcome. Pure presentation over a {@link CheckState}; the glyph/color come from
 * the shared {@link ../view} vocabulary so the TUI and the line fallback agree.
 */
import { Text } from "ink";
import type { CheckState } from "../store";
import { checkText, COLORS } from "../view";

export function CheckStatus({ check }: { readonly check: CheckState }) {
  return <Text color={COLORS.check[check.status]}>{checkText(check)}</Text>;
}
