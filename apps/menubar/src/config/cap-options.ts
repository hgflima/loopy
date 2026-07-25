/**
 * Options helpers for probed mode/model/effort selects — the shared source that
 * the `ConfigPane` (registry), the `StepEditor` (per-Step override) and the
 * `SpecsPane` (authoring selection, C-0018) all build their `<select>` from.
 *
 * The one rule these encode (D31): a select must always contain its own current
 * value, even one the probe didn't announce — the yml is the user's, and an
 * adapter can accept more than it advertises. Dropping an unknown value would
 * silently rewrite it on save.
 */

/**
 * Ensure the current value is present in the options list. If it isn't (and it
 * is non-empty), prepend it — preserving an unknown value already in the yml.
 */
export function ensureOption(
  options: readonly string[],
  currentValue: string | undefined,
): readonly string[] {
  if (!currentValue || currentValue === "" || options.includes(currentValue)) {
    return options;
  }
  return [currentValue, ...options];
}

/**
 * Options for a flat probed select (no registry/inherited layer): the announced
 * values, plus the current value if unknown, plus a leading empty option meaning
 * "no value / agent default" when nothing is selected.
 *
 * This is the two-argument variant used where the value is stored flat — the
 * `ConfigPane` registry and the `SpecsPane` authoring selection. The
 * `StepEditor`'s three-argument variant layers an inherited default on top.
 */
export function capOptions(
  values: readonly string[],
  current: string | undefined,
): readonly string[] {
  const withCurrent = ensureOption(values, current);
  return current ? withCurrent : ["", ...withCurrent];
}
