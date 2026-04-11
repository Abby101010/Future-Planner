/* ──────────────────────────────────────────────────────────
   NorthStar — Weekly Availability Grid
   Click or drag to select time blocks. Click again to cycle
   importance. Right-click to add a label.
   ────────────────────────────────────────────────────────── */

import { useState, useCallback, useRef } from "react";
import { X } from "lucide-react";
import type { TimeBlock } from "@northstar/core";
import "./WeeklyAvailabilityGrid.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// Show useful hours only (6am – 11pm)
const START_HOUR = 6;
const END_HOUR = 23;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i);

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h < 12) return `${h}a`;
  if (h === 12) return "12p";
  return `${h - 12}p`;
}

function formatRange(h: number): string {
  return `${formatHour(h)}\u2013${formatHour(h + 1)}`;
}

interface Props {
  value: TimeBlock[];
  onChange: (blocks: TimeBlock[]) => void;
  language?: "en" | "zh";
}

export default function WeeklyAvailabilityGrid({ value, onChange, language = "en" }: Props) {
  const [editingBlock, setEditingBlock] = useState<{ day: number; hour: number } | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const dayLabels = language === "zh" ? DAYS_ZH : DAYS;

  // ── Drag state (refs to avoid re-renders mid-drag) ──
  const dragging = useRef(false);
  // Drag mode determined by the first cell:
  //   "paint-1" = empty→light grey,  "paint-2" = light→dark,
  //   "paint-3" = dark→darkest,      "erase" = darkest→empty
  const dragMode = useRef<"paint-1" | "paint-2" | "paint-3" | "erase">("paint-1");
  const dragVisited = useRef<Set<string>>(new Set());
  // Keep a mutable ref to the latest value so drag callbacks see fresh data
  const valueRef = useRef(value);
  valueRef.current = value;

  const getBlock = useCallback(
    (day: number, hour: number) => value.find((b) => b.day === day && b.hour === hour),
    [value],
  );

  const getBlockFromRef = (day: number, hour: number) =>
    valueRef.current.find((b) => b.day === day && b.hour === hour);

  // ── Drag apply: set cell to the target importance for this drag ──
  const applyDrag = useCallback(
    (day: number, hour: number) => {
      const key = `${day}-${hour}`;
      if (dragVisited.current.has(key)) return;
      dragVisited.current.add(key);

      const mode = dragMode.current;

      if (mode === "erase") {
        const next = valueRef.current.filter((b) => !(b.day === day && b.hour === hour));
        valueRef.current = next;
        onChange(next);
        return;
      }

      // Target importance: paint-1→1, paint-2→2, paint-3→3
      const targetImportance = (mode === "paint-1" ? 1 : mode === "paint-2" ? 2 : 3) as 1 | 2 | 3;
      const existing = getBlockFromRef(day, hour);

      if (!existing) {
        // Empty cell → set to target importance
        const next = [...valueRef.current, { day, hour, importance: targetImportance, label: "" }];
        valueRef.current = next;
        onChange(next);
      } else if (existing.importance < targetImportance) {
        // Existing cell below target → promote it
        const next = valueRef.current.map((b) =>
          b.day === day && b.hour === hour ? { ...b, importance: targetImportance } : b,
        );
        valueRef.current = next;
        onChange(next);
      }
      // If already at or above target, leave it alone
    },
    [onChange],
  );

  // ── Pointer handlers ──
  const handlePointerDown = useCallback(
    (day: number, hour: number) => {
      const existing = getBlockFromRef(day, hour);
      dragging.current = true;
      dragVisited.current = new Set();

      // Determine mode from the starting cell's current state:
      //   empty → paint to level 1 (light grey)
      //   level 1 → paint to level 2 (dark grey)
      //   level 2 → paint to level 3 (darkest)
      //   level 3 → erase
      if (!existing) {
        dragMode.current = "paint-1";
      } else if (existing.importance === 1) {
        dragMode.current = "paint-2";
      } else if (existing.importance === 2) {
        dragMode.current = "paint-3";
      } else {
        dragMode.current = "erase";
      }

      applyDrag(day, hour);
    },
    [applyDrag],
  );

  const handlePointerEnter = useCallback(
    (day: number, hour: number) => {
      if (!dragging.current) return;
      applyDrag(day, hour);
    },
    [applyDrag],
  );

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
    dragVisited.current = new Set();
  }, []);

  // ── Single-click: no-op since pointerDown handles it, but needed
  //    to prevent default browser behavior during drag ──
  const handleClick = useCallback(
    (_day: number, _hour: number) => {
      // pointerDown already applied the action for single-click
    },
    [],
  );

  // ── Right-click: label editor ──
  const handleCellRightClick = (e: React.MouseEvent, day: number, hour: number) => {
    e.preventDefault();
    const existing = getBlock(day, hour);
    if (existing) {
      setEditingBlock({ day, hour });
      setLabelInput(existing.label);
    }
  };

  const handleLabelSave = () => {
    if (!editingBlock) return;
    onChange(
      value.map((b) =>
        b.day === editingBlock.day && b.hour === editingBlock.hour
          ? { ...b, label: labelInput.trim() }
          : b,
      ),
    );
    setEditingBlock(null);
    setLabelInput("");
  };

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleLabelSave();
    if (e.key === "Escape") {
      setEditingBlock(null);
      setLabelInput("");
    }
  };

  return (
    <div
      className="avail-grid-wrapper"
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      <div className="avail-grid-hint">
        {language === "zh"
          ? "点击或拖拽选择时间 · 再次拖拽已选区域提升优先级 · 右键添加描述"
          : "Click or drag to select · Drag again over selected to increase priority · Right-click to label"}
      </div>

      <div className="avail-grid-scroll">
        <div className="avail-grid">
          {/* Header row */}
          <div className="avail-grid-corner" />
          {dayLabels.map((d, i) => (
            <div key={i} className="avail-grid-day-header">
              {d}
            </div>
          ))}

          {/* Time rows */}
          {HOURS.map((hour) => (
            <div key={`row-${hour}`} className="avail-grid-row">
              <div className="avail-grid-hour-label">
                <span className="avail-grid-hour-range">{formatRange(hour)}</span>
              </div>
              {Array.from({ length: 7 }, (_, day) => {
                const block = getBlock(day, hour);
                const importance = block?.importance || 0;
                return (
                  <div
                    key={`${day}-${hour}`}
                    className={`avail-grid-cell avail-grid-cell--${importance}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      handlePointerDown(day, hour);
                    }}
                    onPointerEnter={() => handlePointerEnter(day, hour)}
                    onClick={() => handleClick(day, hour)}
                    onContextMenu={(e) => handleCellRightClick(e, day, hour)}
                    title={
                      block?.label
                        ? block.label
                        : importance > 0
                          ? language === "zh" ? "右键添加描述" : "Right-click to label"
                          : ""
                    }
                  >
                    {block?.label && <span className="avail-grid-cell-label">{block.label}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="avail-grid-legend">
        <div className="avail-grid-legend-item">
          <div className="avail-grid-cell avail-grid-cell--0 avail-grid-legend-swatch" />
          <span>{language === "zh" ? "不可用" : "Unavailable"}</span>
        </div>
        <div className="avail-grid-legend-item">
          <div className="avail-grid-cell avail-grid-cell--1 avail-grid-legend-swatch" />
          <span>{language === "zh" ? "有空" : "Available"}</span>
        </div>
        <div className="avail-grid-legend-item">
          <div className="avail-grid-cell avail-grid-cell--2 avail-grid-legend-swatch" />
          <span>{language === "zh" ? "更空闲" : "Preferred"}</span>
        </div>
        <div className="avail-grid-legend-item">
          <div className="avail-grid-cell avail-grid-cell--3 avail-grid-legend-swatch" />
          <span>{language === "zh" ? "最佳时段" : "Prime time"}</span>
        </div>
      </div>

      {/* Label popover */}
      {editingBlock && (
        <div className="avail-label-overlay" onClick={() => setEditingBlock(null)}>
          <div className="avail-label-popover" onClick={(e) => e.stopPropagation()}>
            <div className="avail-label-popover-header">
              <span>
                {dayLabels[editingBlock.day]} {formatRange(editingBlock.hour)}
              </span>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingBlock(null)}>
                <X size={14} />
              </button>
            </div>
            <input
              className="input"
              placeholder={language === "zh" ? "这段时间用来做什么？" : "What is this time for?"}
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={handleLabelKeyDown}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={handleLabelSave}>
              {language === "zh" ? "保存" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
