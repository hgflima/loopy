/** Derive a stable DOM id from a label string. */
export function makeFieldId(label: string, override?: string): string {
  return override ?? `field-${label.replace(/\W+/g, "-").toLowerCase()}`;
}
