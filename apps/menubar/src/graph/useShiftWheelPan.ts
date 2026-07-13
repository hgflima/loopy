import { useEffect, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";

// Matches the default panOnScrollSpeed in @xyflow/react 12.x,
// so horizontal pan via shift+wheel feels identical to vertical.
const PAN_SPEED = 0.5;

export function useShiftWheelPan(ref: RefObject<HTMLElement | null>): void {
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || e.deltaX !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const vp = getViewport();
      setViewport({ ...vp, x: vp.x - e.deltaY * PAN_SPEED });
    };

    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [ref, getViewport, setViewport]);
}
