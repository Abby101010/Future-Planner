/* ──────────────────────────────────────────────────────────
   NorthStar — GitHub-style calendar heatmap
   ────────────────────────────────────────────────────────── */

import { useMemo } from "react";
import { useT } from "../i18n";
import type { HeatmapEntry } from "../types";
import "./Heatmap.css";

interface Props {
  data: HeatmapEntry[];
}

const CELL_SIZE = 13;
const CELL_GAP = 3;
const WEEKS_TO_SHOW = 20;

const LEVEL_COLORS = [
  "var(--heatmap-0)",
  "var(--heatmap-1)",
  "var(--heatmap-2)",
  "var(--heatmap-3)",
  "var(--heatmap-4)",
];

export default function Heatmap({ data }: Props) {
  const t = useT();
  const MONTHS = t.heatmap.months;
  const DAYS = t.heatmap.days;
  const dataMap = useMemo(() => {
    const m = new Map<string, number>();
    data.forEach((e) => m.set(e.date, e.completionLevel));
    return m;
  }, [data]);

  const cells = useMemo(() => {
    const result: Array<{
      date: string;
      level: number;
      x: number;
      y: number;
      month: number;
    }> = [];

    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - WEEKS_TO_SHOW * 7);
    // Align to Sunday
    startDate.setDate(startDate.getDate() - startDate.getDay());

    let week = 0;
    const current = new Date(startDate);

    while (current <= today) {
      const dayOfWeek = current.getDay();
      const dateStr = current.toISOString().split("T")[0];
      result.push({
        date: dateStr,
        level: dataMap.get(dateStr) ?? -1, // -1 = no data
        x: week * (CELL_SIZE + CELL_GAP),
        y: dayOfWeek * (CELL_SIZE + CELL_GAP),
        month: current.getMonth(),
      });

      if (dayOfWeek === 6) week++;
      current.setDate(current.getDate() + 1);
    }

    return result;
  }, [dataMap]);

  // Month labels
  const monthLabels = useMemo(() => {
    const labels: Array<{ label: string; x: number }> = [];
    let lastMonth = -1;
    cells.forEach((cell) => {
      if (cell.month !== lastMonth) {
        labels.push({ label: MONTHS[cell.month], x: cell.x });
        lastMonth = cell.month;
      }
    });
    return labels;
  }, [cells, MONTHS]);

  const svgWidth = (WEEKS_TO_SHOW + 1) * (CELL_SIZE + CELL_GAP) + 30;
  const svgHeight = 7 * (CELL_SIZE + CELL_GAP) + 24;

  return (
    <div className="heatmap-container card">
      <svg
        width={svgWidth}
        height={svgHeight}
        className="heatmap-svg"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      >
        {/* Day labels */}
        {DAYS.map((label, i) =>
          label ? (
            <text
              key={i}
              x={0}
              y={i * (CELL_SIZE + CELL_GAP) + CELL_SIZE + 20}
              className="heatmap-label"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {label}
            </text>
          ) : null
        )}

        {/* Month labels */}
        {monthLabels.map((m, i) => (
          <text
            key={i}
            x={m.x + 30}
            y={12}
            className="heatmap-label"
            fontSize={10}
            fill="var(--text-muted)"
          >
            {m.label}
          </text>
        ))}

        {/* Cells */}
        {cells.map((cell, i) => (
          <rect
            key={i}
            x={cell.x + 30}
            y={cell.y + 20}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={3}
            fill={
              cell.level >= 0
                ? LEVEL_COLORS[cell.level]
                : "var(--heatmap-0)"
            }
            className="heatmap-cell"
          >
            <title>
              {cell.date}
              {cell.level >= 0 ? ` — Level ${cell.level}` : ""}
            </title>
          </rect>
        ))}
      </svg>

      {/* Legend */}
      <div className="heatmap-legend">
        <span className="heatmap-legend-label">{t.heatmap.less}</span>
        {LEVEL_COLORS.map((color, i) => (
          <div
            key={i}
            className="heatmap-legend-cell"
            style={{ background: color }}
          />
        ))}
        <span className="heatmap-legend-label">{t.heatmap.more}</span>
      </div>
    </div>
  );
}
