import { afterEach, describe, expect, it, vi } from "vitest";
import { isMacOS, modKeyLabel } from "./platform";

function stubUserAgent(ua: string): void {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}

describe("platform", () => {
  afterEach(() => vi.restoreAllMocks());

  it("detects macOS (WKWebView) and shows ⌘", () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
    );
    expect(isMacOS()).toBe(true);
    expect(modKeyLabel()).toBe("⌘");
  });

  it("treats Linux (WebKitGTK) as non-mac and shows Ctrl+", () => {
    stubUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15");
    expect(isMacOS()).toBe(false);
    expect(modKeyLabel()).toBe("Ctrl+");
  });

  it("treats Windows (WebView2) as non-mac", () => {
    stubUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/120.0",
    );
    expect(isMacOS()).toBe(false);
  });
});
