import { renderHook } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const getViewport = vi.fn(() => ({ x: 0, y: 0, zoom: 1 }));
const setViewport = vi.fn();

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ getViewport, setViewport }),
}));

const { useShiftWheelPan } = await import("./useShiftWheelPan");

describe("useShiftWheelPan", () => {
  let container: HTMLDivElement;
  let ref: { current: HTMLDivElement };

  function fireWheel(overrides: Partial<WheelEventInit> = {}) {
    const event = new WheelEvent("wheel", {
      deltaY: 100,
      deltaX: 0,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
      ...overrides,
    });
    container.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    getViewport.mockReturnValue({ x: 0, y: 0, zoom: 1 });
    setViewport.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    ref = { current: container };
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("shift + deltaY pans horizontally and prevents default", () => {
    renderHook(() => useShiftWheelPan(ref));

    const event = fireWheel();

    expect(setViewport).toHaveBeenCalledWith({ x: -50, y: 0, zoom: 1 });
    expect(event.defaultPrevented).toBe(true);
  });

  it("shift + deltaX !== 0 (WebKit axis swap) is a no-op", () => {
    renderHook(() => useShiftWheelPan(ref));

    const event = fireWheel({ deltaY: 0, deltaX: 100 });

    expect(setViewport).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("no shiftKey is a no-op", () => {
    renderHook(() => useShiftWheelPan(ref));

    const event = fireWheel({ shiftKey: false });

    expect(setViewport).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("registers listener with passive: false and capture: true", () => {
    const spy = vi.spyOn(container, "addEventListener");
    renderHook(() => useShiftWheelPan(ref));

    const call = spy.mock.calls.find(([type]) => type === "wheel");
    expect(call).toBeDefined();
    expect(call![2]).toEqual(
      expect.objectContaining({ passive: false, capture: true }),
    );
    spy.mockRestore();
  });

  it("unmount removes the listener", () => {
    const spy = vi.spyOn(container, "removeEventListener");
    const { unmount } = renderHook(() => useShiftWheelPan(ref));

    unmount();

    const call = spy.mock.calls.find(([type]) => type === "wheel");
    expect(call).toBeDefined();
    expect(call![2]).toEqual(expect.objectContaining({ capture: true }));
    spy.mockRestore();
  });
});
