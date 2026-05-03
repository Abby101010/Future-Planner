import type { ReactNode } from "react";
import useStore, { type PaneId } from "../store/useStore";

export default function PaneFrame({
  paneId,
  children,
}: {
  paneId: PaneId;
  children: ReactNode;
}) {
  const activePane = useStore((s) => s.activePane);
  const setActivePane = useStore((s) => s.setActivePane);
  const closePane = useStore((s) => s.closePane);
  const isActive = activePane === paneId;

  return (
    <div
      className={`pane-frame${isActive ? " pane-frame--active" : ""}`}
      data-pane={paneId}
      data-testid={`pane-${paneId}`}
      onMouseDown={() => {
        if (!isActive) setActivePane(paneId);
      }}
    >
      <button
        type="button"
        className="pane-close"
        onClick={(e) => {
          e.stopPropagation();
          closePane(paneId);
        }}
        title="Close pane"
        aria-label={`Close ${paneId} pane`}
        data-testid={`pane-close-${paneId}`}
      >
        ×
      </button>
      <div className="pane-content">{children}</div>
    </div>
  );
}
