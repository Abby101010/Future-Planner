/* Layout slice tests — covers the split-pane store actions
 * (openInPane, closePane, setDividerRatio, setActivePane) plus the
 * split-mode behavior of setView. */

import { afterEach, describe, expect, it } from "vitest";
import useStore from "./useStore";

const initial = useStore.getState();

afterEach(() => {
  useStore.setState({
    currentView: initial.currentView,
    rightPaneView: null,
    activePane: "left",
    dividerRatio: 0.5,
    chatModeOverride: null,
    draggedView: null,
  });
});

describe("layout slice — defaults", () => {
  it("starts single-pane with sensible defaults", () => {
    const s = useStore.getState();
    expect(s.rightPaneView).toBeNull();
    expect(s.activePane).toBe("left");
    expect(s.dividerRatio).toBe(0.5);
  });
});

describe("openInPane", () => {
  it("drop on LEFT in single-pane promotes to split: existing view moves to right", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: null });
    useStore.getState().openInPane("calendar", "left");
    const s = useStore.getState();
    expect(s.currentView).toBe("calendar");
    expect(s.rightPaneView).toBe("tasks");
    expect(s.activePane).toBe("left");
  });

  it("drop on RIGHT in single-pane promotes to split: existing view stays on left", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: null });
    useStore.getState().openInPane("planning", "right");
    const s = useStore.getState();
    expect(s.currentView).toBe("tasks");
    expect(s.rightPaneView).toBe("planning");
    expect(s.activePane).toBe("right");
  });

  it("is a no-op when the view is already in the OTHER pane", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "right" });
    useStore.getState().openInPane("tasks", "right");
    const s = useStore.getState();
    expect(s.currentView).toBe("tasks");
    expect(s.rightPaneView).toBe("calendar");
  });

  it("is a no-op when the view is already in the SAME pane", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: null });
    useStore.getState().openInPane("tasks", "left");
    const s = useStore.getState();
    expect(s.currentView).toBe("tasks");
    expect(s.rightPaneView).toBeNull();
  });

  it("replaces the right pane when already in split mode", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "left" });
    useStore.getState().openInPane("planning", "right");
    const s = useStore.getState();
    expect(s.currentView).toBe("tasks");
    expect(s.rightPaneView).toBe("planning");
    expect(s.activePane).toBe("right");
  });

  it("replaces the left pane when already in split mode (preserves right)", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "right" });
    useStore.getState().openInPane("planning", "left");
    const s = useStore.getState();
    expect(s.currentView).toBe("planning");
    expect(s.rightPaneView).toBe("calendar");
    expect(s.activePane).toBe("left");
  });
});

describe("closePane", () => {
  it("is a no-op in single-pane mode", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: null });
    useStore.getState().closePane("right");
    expect(useStore.getState().rightPaneView).toBeNull();
    expect(useStore.getState().currentView).toBe("tasks");
  });

  it("closes the right pane and keeps the left view", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "right" });
    useStore.getState().closePane("right");
    const s = useStore.getState();
    expect(s.rightPaneView).toBeNull();
    expect(s.currentView).toBe("tasks");
    expect(s.activePane).toBe("left");
  });

  it("closes the left pane and promotes the right view to current", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "left" });
    useStore.getState().closePane("left");
    const s = useStore.getState();
    expect(s.rightPaneView).toBeNull();
    expect(s.currentView).toBe("calendar");
    expect(s.activePane).toBe("left");
  });
});

describe("setDividerRatio", () => {
  it("clamps below 0.3", () => {
    useStore.getState().setDividerRatio(0.1);
    expect(useStore.getState().dividerRatio).toBe(0.3);
  });

  it("clamps above 0.7", () => {
    useStore.getState().setDividerRatio(0.95);
    expect(useStore.getState().dividerRatio).toBe(0.7);
  });

  it("accepts values inside the range", () => {
    useStore.getState().setDividerRatio(0.42);
    expect(useStore.getState().dividerRatio).toBeCloseTo(0.42, 5);
  });
});

describe("setActivePane", () => {
  it("ignores 'right' when right pane is empty", () => {
    useStore.setState({ rightPaneView: null, activePane: "left" });
    useStore.getState().setActivePane("right");
    expect(useStore.getState().activePane).toBe("left");
  });

  it("switches to right pane when populated", () => {
    useStore.setState({ rightPaneView: "calendar", activePane: "left" });
    useStore.getState().setActivePane("right");
    expect(useStore.getState().activePane).toBe("right");
  });
});

describe("drag slice", () => {
  it("starts and ends a sidebar drag", () => {
    expect(useStore.getState().draggedView).toBeNull();
    useStore.getState().startSidebarDrag("calendar");
    expect(useStore.getState().draggedView).toBe("calendar");
    useStore.getState().endSidebarDrag();
    expect(useStore.getState().draggedView).toBeNull();
  });
});

describe("setView in split mode", () => {
  it("updates currentView when active pane is left", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "left" });
    useStore.getState().setView("planning");
    expect(useStore.getState().currentView).toBe("planning");
    expect(useStore.getState().rightPaneView).toBe("calendar");
  });

  it("updates rightPaneView when active pane is right", () => {
    useStore.setState({ currentView: "tasks", rightPaneView: "calendar", activePane: "right" });
    useStore.getState().setView("planning");
    expect(useStore.getState().currentView).toBe("tasks");
    expect(useStore.getState().rightPaneView).toBe("planning");
  });

  it("clears chatModeOverride on navigation in either pane", () => {
    useStore.setState({
      currentView: "tasks",
      rightPaneView: "calendar",
      activePane: "right",
      chatModeOverride: "general",
    });
    useStore.getState().setView("planning");
    expect(useStore.getState().chatModeOverride).toBeNull();
  });
});
