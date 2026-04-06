/* ──────────────────────────────────────────────────────────
   NorthStar — Weekly Availability Grid
   Click to cycle saturation (importance), describe blocks.
   ────────────────────────────────────────────────────────── */

import { useState, useCallback } from "react";
import { X } from "lucide-react";
import type { TimeBlock } from "../types";
import "./WeeklyAvailabilityGrid.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAYS_ZH = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// Show useful hours only (6am - 11pm)
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
  return `${formatHour(h)}-${formatHour(h + 1)}`;
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

  const getBlock = useCallback(
    (day: number, hour: number) => value.find((b) => b.day === day && b.hour === hour),
    [value]
  );

  const handleCellClick = (day: number, hour: number) => {
    const existing = getBlock(day, hour);

    if (!existing) {
      // First click → importance 1
      onChange([...value, { day, hour, importance: 1, label: "" }]);
    } else if (existing.importance < 3) {
      // Cycle up
      onChange(
        value.map((b) =>
          b.day === day && b.hour === hour
            ? { ...b, importance: (b.importance + 1) as 1 | 2 | 3 }
            : b
        )
      );
    } else {
      // importance 3 → remove
      onChange(value.filter((b) => !(b.day === day && b.hour === hour)));
    }
  };

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
          : b
      )
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
    <div className="avail-grid-wrapper">
      <div className="avail-grid-hint">
        {language === "zh"
          ? "点击选择空闲时间 · 多次点击 = 更重要 · 右键添加描述"
          : "Click to select free time · Click again = more important · Right-click to add label"}
      </div>

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
          <>
            <div key={`h-${hour}`} className="avail-grid-hour-label">
              <span className="avail-grid-hour-range">{formatRange(hour)}</span>
            </div>
            {Array.from({ length: 7 }, (_, day) => {
              const block = getBlock(day, hour);
              const importance = block?.importance || 0;
              return (
                <div
                  key={`${day}-${hour}`}
                  className={`avail-grid-cell avail-grid-cell--${importance}`}
                  onClick={() => handleCellClick(day, hour)}
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
          </>
        ))}
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
