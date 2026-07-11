import { useState, useEffect } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Returns `true` when the user prefers reduced motion (JS gate for D7 pulse). */
export function usePrefersReducedMotion(): boolean {
  const [prefersReduced, setPrefersReduced] = useState(() => {
    if (typeof matchMedia !== "function") return false;
    return matchMedia(QUERY).matches;
  });

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mql = matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return prefersReduced;
}
