import { TrendingUp } from "lucide-react";

export interface BigGoalProgressRow {
  title: string;
  total: number;
  completed: number;
  percent: number;
}

export default function BigGoalProgress({ rows }: { rows: BigGoalProgressRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="big-goal-progress-section animate-slide-up">
      {rows.map((g) => (
        <div key={g.title} className="big-goal-progress-row">
          <div className="big-goal-progress-label">
            <TrendingUp size={14} />
            <span>{g.title}</span>
            <span className="big-goal-progress-pct">{g.percent}%</span>
          </div>
          <div className="progress-bar big-goal-bar">
            <div
              className={`progress-bar-fill ${
                g.percent >= 100 ? "complete" : g.percent >= 50 ? "green" : ""
              }`}
              style={{ width: `${g.percent}%` }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}
