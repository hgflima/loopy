/** A release asset; `url` defaults to the canonical tag download URL. */
export interface ReleaseAsset {
  name: string;
  url?: string;
}

export interface RenderInstructionsInput {
  template: string;
  version: string;
  repo: string;
  npmPackage: string;
  assets: readonly ReleaseAsset[];
}

export interface PlatformSlot {
  key: "LINUX_APPIMAGE" | "LINUX_DEB" | "MACOS_DMG" | "WINDOWS_SETUP";
  label: string;
  match: (name: string) => boolean;
}

export declare const PLATFORMS: readonly PlatformSlot[];

export declare const TEMPLATE_PATH: string;

export declare function classifyAssets(
  assets: readonly ReleaseAsset[],
  release: { repo: string; version: string },
): Map<PlatformSlot["key"], { name: string; url: string }>;

/** Throws when a platform asset is missing/ambiguous, an input is malformed or a placeholder is left over. */
export declare function renderInstructions(
  input: RenderInstructionsInput,
): string;
