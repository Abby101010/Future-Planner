import { useCallback } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import useStore from "../store/useStore";

const DIVIDER_PX = 6;

export default function DividerHandle({
  containerRef,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const setDividerRatio = useStore((s) => s.setDividerRatio);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;

      const onMove = (ev: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const usable = rect.width - DIVIDER_PX;
        if (usable <= 0) return;
        const x = ev.clientX - rect.left - DIVIDER_PX / 2;
        setDividerRatio(x / usable);
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    },
    [containerRef, setDividerRatio]
  );

  return (
    <div
      className="divider-handle"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      data-testid="divider-handle"
    />
  );
}
