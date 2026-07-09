/**
 * sentence-split.ts — breaks prose into one sentence per line (AD-6: pure).
 *
 * Conservative strategy (refine #5): splits on `.` optionally followed by
 * spaces and then an uppercase letter, with a negative whitelist. The space
 * is optional because streaming agent prose often drops it (`configs.Agora`),
 * which is still a real boundary. When in doubt, keeps together (fail-safe).
 *
 * Does NOT split on `?` or `!` (too many false positives in technical prose).
 */

/**
 * Negative whitelist — patterns where a dot followed by a space is NOT
 * a sentence boundary. Covers abbreviations, versions, filenames,
 * decimals, URLs, ellipses, and known proper names.
 */
const NOT_BOUNDARY = new RegExp(
  [
    // Common abbreviations (case-insensitive) — word-boundary required
    String.raw`(?:^|\s)(?:e\.g|i\.e|vs|etc|al|cf|approx|ca|dept|est|govt|inc|jr|sr|dr|mr|mrs|ms|prof|st|ft|vol|no|op|ed|rev|gen|col|sgt|cpl|pvt|lt|cmdr|adm|supt|assn|bros|corp|dist|div|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)$`,
    // Version numbers: v0.26, V1.0 (minor can exceed 4 chars)
    String.raw`[vV]\d+\.\d+$`,
    // Filenames: word.ext (1-4 char ext) — also covers Node.js, D3.js, Deno.land, etc.
    String.raw`\w+\.\w{1,4}$`,
    // Decimals: 20.5 (fractional part can exceed 4 digits)
    String.raw`\d+\.\d+$`,
    // Ellipsis: ...
    String.raw`\.{2,}$`,
  ].join("|"),
  "i",
);

/**
 * Checks whether the text before a `. ` is a URL (contains `://`).
 * URLs can have dots anywhere, so we check the preceding "word" broadly.
 */
function isInsideUrl(before: string): boolean {
  // Look for a URL-like pattern in the tail of `before`
  return /https?:\/\/\S*$/i.test(before);
}

/**
 * Split prose into one sentence per line.
 *
 * Splits at `.` (with or without following spaces) before a Unicode uppercase
 * letter. Returns the input unchanged if no splits apply.
 */
export function splitSentences(prose: string): string {
  if (!prose) return prose;

  // Process line by line to preserve existing line breaks
  return prose
    .split("\n")
    .map((line) => splitLine(line))
    .join("\n");
}

/** Matches `.` + optional spaces + any Unicode uppercase letter. */
const BOUNDARY = /\.\s*(\p{Lu})/u;

function splitLine(line: string): string {
  const result: string[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    const match = remaining.match(BOUNDARY);
    if (!match || match.index === undefined) {
      result.push(remaining);
      break;
    }

    const dotIndex = match.index;
    // match[0] = ".X" or ". X" (dot + optional spaces + uppercase char); the
    // next sentence starts at the uppercase char, one char before the match ends.
    const nextStart = dotIndex + match[0].length - 1;
    const before = remaining.slice(0, dotIndex);

    if (NOT_BOUNDARY.test(before) || isInsideUrl(before)) {
      // Not a boundary — skip past this dot + spaces
      result.push(remaining.slice(0, nextStart));
      remaining = remaining.slice(nextStart);
      continue;
    }

    // Real sentence boundary — split after the dot
    result.push(remaining.slice(0, dotIndex + 1), "\n");
    remaining = remaining.slice(nextStart);
  }

  return result.join("");
}
