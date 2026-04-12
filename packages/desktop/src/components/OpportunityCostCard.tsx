/* NorthStar — Opportunity Cost Card
 *
 * Displayed during the friction flow when a user tries to add a 4th big
 * goal. Shows the time impact on existing goals so they can make an
 * informed trade-off decision.
 */

import { AlertTriangle } from "lucide-react";
import "./OpportunityCostCard.css";

export interface OpportunityCostData {
  weeklyHoursRequired: number;
  affectedGoals: Array<{
    goalId: string;
    title: string;
    currentWeeklyHours: number;
    projectedWeeklyHours: number;
    reductionPercent: number;
  }>;
  deepWorkImpact: {
    currentDailyMinutes: number;
    projectedDailyMinutes: number;
  };
  warning: string | null;
}

interface Props {
  newGoalTitle: string;
  cost: OpportunityCostData;
  onProceed?: () => void;
  onPark?: () => void;
}

export default function OpportunityCostCard({
  newGoalTitle,
  cost,
  onProceed,
  onPark,
}: Props) {
  const deepWorkReduction = cost.deepWorkImpact.currentDailyMinutes - cost.deepWorkImpact.projectedDailyMinutes;
  const deepWorkHours = (cost.deepWorkImpact.projectedDailyMinutes / 60).toFixed(1);

  return (
    <div className="opp-cost-card">
      <div className="opp-cost-header">
        <AlertTriangle size={16} className="opp-cost-icon" />
        <span className="opp-cost-title">Adding "{newGoalTitle}"</span>
      </div>

      <div className="opp-cost-stat">
        <span className="opp-cost-label">Weekly time needed</span>
        <span className="opp-cost-value">~{cost.weeklyHoursRequired} hrs/week</span>
      </div>

      {cost.affectedGoals.length > 0 && (
        <div className="opp-cost-section">
          <span className="opp-cost-section-label">Impact on existing goals</span>
          {cost.affectedGoals.map((g) => (
            <div key={g.goalId} className="opp-cost-goal-row">
              <span className="opp-cost-goal-title">{g.title}</span>
              <span className="opp-cost-goal-impact">
                {g.currentWeeklyHours}h → {g.projectedWeeklyHours}h
                <span className="opp-cost-reduction">(-{g.reductionPercent}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {deepWorkReduction > 0 && (
        <div className="opp-cost-stat">
          <span className="opp-cost-label">Deep work</span>
          <span className="opp-cost-value">
            {(cost.deepWorkImpact.currentDailyMinutes / 60).toFixed(1)}h/day → {deepWorkHours}h/day
          </span>
        </div>
      )}

      {cost.warning && (
        <div className="opp-cost-warning">{cost.warning}</div>
      )}

      {(onProceed || onPark) && (
        <div className="opp-cost-actions">
          {onPark && (
            <button className="btn btn-secondary opp-cost-btn" onClick={onPark}>
              Keep in Parking Lot
            </button>
          )}
          {onProceed && (
            <button className="btn btn-primary opp-cost-btn" onClick={onProceed}>
              Proceed Anyway
            </button>
          )}
        </div>
      )}
    </div>
  );
}
