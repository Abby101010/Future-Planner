import { Flag, CheckCircle2, Circle } from "lucide-react";

interface MilestoneProgress {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  completed: boolean;
  segmentTotal: number;
  segmentCompleted: number;
  progressPercent: number;
}

interface Props {
  milestones: MilestoneProgress[];
  t: any;
}

export default function GoalPlanMilestoneTimeline({ milestones, t }: Props) {
  if (milestones.length === 0) return null;
  return (
    <section className="gp-milestones animate-slide-up">
      <h3 className="gp-section-heading">
        <Flag size={16} />
        {t.goalPlan.milestoneTimeline}
      </h3>
      <div className="gp-milestone-track">
        {milestones.map((ms, i) => {
          const isInProgress = ms.progressPercent > 0 && !ms.completed;
          return (
            <div
              key={ms.id}
              className={`gp-milestone ${ms.completed ? "completed" : ""} ${isInProgress ? "in-progress" : ""}`}
            >
              <div className="gp-milestone-dot">
                {ms.completed ? <CheckCircle2 size={16} /> : <Circle size={16} />}
              </div>
              {i < milestones.length - 1 && (
                <div className="gp-milestone-line">
                  <div
                    className="gp-milestone-line-fill"
                    style={{ height: `${ms.completed ? 100 : ms.progressPercent}%` }}
                  />
                </div>
              )}
              <div className="gp-milestone-info">
                <span className="gp-milestone-title">{ms.title}</span>
                <span className="gp-milestone-desc">{ms.description}</span>
                <span className="gp-milestone-date">{ms.targetDate}</span>
                {ms.segmentTotal > 0 && (
                  <div className="gp-milestone-progress">
                    <div className="gp-milestone-progress-bar">
                      <div
                        className="gp-milestone-progress-fill"
                        style={{ width: `${ms.progressPercent}%` }}
                      />
                    </div>
                    <span className="gp-milestone-progress-label">
                      {t.goalPlan.milestoneProgress(
                        ms.segmentCompleted,
                        ms.segmentTotal,
                        ms.progressPercent,
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
