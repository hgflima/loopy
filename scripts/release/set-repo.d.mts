/** Validate an `owner/repo` slug; throws on anything else. */
export function parseRepo(repo: unknown): string;

/**
 * Copy of `pkg` with `repository.url`, `bugs.url` and `homepage` pointing at
 * `https://github.com/<repo>`; everything else untouched. Throws on an invalid
 * `repo`.
 */
export function setRepo<T extends Record<string, unknown>>(
  pkg: T,
  repo: string,
): T;
