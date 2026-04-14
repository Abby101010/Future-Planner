import { Target, Flame, Check } from "lucide-react";
import { useT } from "../../i18n";
import type { DailyLog } from "@northstar/core";

interface Props {
  todayLog: DailyLog;
  completedCount: number;
  totalCount: number;
  completionRate: number;
}

export default function ProgressRow({
  todayLog,
  completedCount,
  totalCount,
  completionRate,
}: Props) {
  const t = useT();
  return (
    <div className="progress-row animate-fade-in">
      <div className="progress-card">
        <div className="progress-card-label">
          <Target size={14} />
          {t.dashboard.overall}
        </div>
        <div className="progress-card-value">
          {todayLog.progress.overallPercent.toFixed(1)}%
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${todayLog.progress.overallPercent}%` }}
          />
        </div>
      </div>

      <div className="progress-card">
        <div className="progress-card-label">
          <Check size={14} />
          {t.dashboard.today}
        </div>
        <div className="progress-card-value">
          {completedCount}/{totalCount}
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill green"
            style={{ width: `${completionRate}%` }}
          />
        </div>
      </div>

      <div className="progress-card">
        <div className="progress-card-label">
          <Flame size={14} />
          {t.dashboard.milestone}
        </div>
        <div className="progress-card-value">
          {completionRate.toFixed(1)}%
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${completionRate}%` }}
          />
        </div>
      </div>
    </div>
  );
}
