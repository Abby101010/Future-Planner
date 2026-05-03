import { useRef } from "react";
import useStore from "../store/useStore";
import { renderView } from "../views/registry";
import PaneFrame from "./PaneFrame";
import DividerHandle from "./DividerHandle";

export default function SplitWorkspace() {
  const containerRef = useRef<HTMLDivElement>(null);
  const leftView = useStore((s) => s.currentView);
  const rightView = useStore((s) => s.rightPaneView);
  const ratio = useStore((s) => s.dividerRatio);

  if (!rightView) return null;

  return (
    <div
      ref={containerRef}
      className="split-workspace"
      data-testid="split-workspace"
      style={{ gridTemplateColumns: `${ratio}fr 6px ${1 - ratio}fr` }}
    >
      <PaneFrame paneId="left">{renderView(leftView)}</PaneFrame>
      <DividerHandle containerRef={containerRef} />
      <PaneFrame paneId="right">{renderView(rightView)}</PaneFrame>
    </div>
  );
}
