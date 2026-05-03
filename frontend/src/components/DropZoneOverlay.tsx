import { useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import useStore, { type PaneId } from "../store/useStore";

export default function DropZoneOverlay() {
  const draggedView = useStore((s) => s.draggedView);
  const openInPane = useStore((s) => s.openInPane);
  const endSidebarDrag = useStore((s) => s.endSidebarDrag);
  const [hover, setHover] = useState<PaneId | null>(null);

  if (!draggedView) return null;

  const onDragOver = (pane: PaneId) => (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (hover !== pane) setHover(pane);
  };
  const onDragLeave = (pane: PaneId) => () => {
    setHover((h) => (h === pane ? null : h));
  };
  const onDrop = (pane: PaneId) => (e: ReactDragEvent<HTMLDivElement>) => {
    e.preventDefault();
    openInPane(draggedView, pane);
    setHover(null);
    endSidebarDrag();
  };

  return (
    <div className="drop-zone-overlay" data-testid="drop-zone-overlay">
      <div
        className={`drop-zone-overlay__half${hover === "left" ? " drop-zone-overlay__half--active" : ""}`}
        onDragOver={onDragOver("left")}
        onDragLeave={onDragLeave("left")}
        onDrop={onDrop("left")}
        data-testid="drop-zone-left"
      >
        <span className="drop-zone-overlay__label">Open on left</span>
      </div>
      <div
        className={`drop-zone-overlay__half${hover === "right" ? " drop-zone-overlay__half--active" : ""}`}
        onDragOver={onDragOver("right")}
        onDragLeave={onDragLeave("right")}
        onDrop={onDrop("right")}
        data-testid="drop-zone-right"
      >
        <span className="drop-zone-overlay__label">Open on right</span>
      </div>
    </div>
  );
}
