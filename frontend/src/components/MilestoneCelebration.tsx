/* ──────────────────────────────────────────────────────────
   NorthStar — Milestone celebration overlay
   ────────────────────────────────────────────────────────── */

import { Trophy, ArrowRight, PartyPopper } from "lucide-react";
import { useT } from "../i18n";
import type { MilestoneCelebration as CelebrationType } from "../types";
import "./MilestoneCelebration.css";

interface Props {
  celebration: CelebrationType;
  onClose: () => void;
}

export default function MilestoneCelebration({ celebration, onClose }: Props) {
  const t = useT();

  return (
    <div className="celebration-overlay" onClick={onClose}>
      <div
        className="celebration-card animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="celebration-header">
          <PartyPopper size={32} className="celebration-confetti" />
          <Trophy size={48} className="celebration-trophy" />
          <PartyPopper size={32} className="celebration-confetti flip" />
        </div>

        <h2 className="celebration-title">{t.celebration.title}</h2>
        <h3 className="celebration-milestone">{celebration.milestoneTitle}</h3>

        <div className="celebration-stats">
          <div className="celebration-stat">
            <span className="stat-value">{celebration.daysTaken}</span>
            <span className="stat-label">{t.celebration.days}</span>
          </div>
          <div className="celebration-divider" />
          <div className="celebration-stat">
            <span className="stat-value">
              {celebration.tasksCompletedInMilestone}
            </span>
            <span className="stat-label">{t.celebration.tasksDone}</span>
          </div>
        </div>

        <p className="celebration-summary">{celebration.achievementSummary}</p>

        <div className="celebration-next">
          <ArrowRight size={14} />
          <span>{t.celebration.upNext(celebration.nextMilestonePreview)}</span>
        </div>

        <button className="btn btn-primary btn-lg w-full" onClick={onClose}>
          {t.celebration.keepGoing}
        </button>
      </div>
    </div>
  );
}
