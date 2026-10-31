/** Os manifestos que carregam a versão do release (E4). */
export interface VersionFiles {
  root: Record<string, unknown>;
  menubar: Record<string, unknown>;
  lock: Record<string, unknown>;
}

/** Caminhos, relativos à raiz do repo, de cada manifesto. */
export declare const VERSION_FILES: Readonly<
  Record<keyof VersionFiles, string>
>;

/** Valida uma versão semver (sem `v`); lança em qualquer outra coisa. */
export declare function parseVersion(version: unknown): string;

/**
 * Cópia dos manifestos com `version` gravada na raiz, no menubar e nas
 * entradas do lockfile (topo, `packages[""]`, `packages["apps/menubar"]`).
 * Lança em versão não-semver ou lockfile sem essas entradas.
 */
export declare function syncVersion<F extends VersionFiles>(
  files: F,
  version: string,
): F;
