import NudgeCard from "./NudgeCard";
import type { ContextualNudge } from "../types";

interface Props {
  nudges: ContextualNudge[];
  onDismiss: (id: string) => void;
  onRespond: (id: string, feedbackValue: string, isPositive: boolean) => void;
}

export default function NudgesSection({ nudges, onDismiss, onRespond }: Props) {
  const active = nudges.filter((n) => !n.dismissed);
  if (active.length === 0) return null;
  return (
    <section className="nudges-section animate-slide-up">
      {active.slice(0, 3).map((nudge) => (
        <NudgeCard
          key={nudge.id}
          nudge={nudge}
          onDismiss={() => onDismiss(nudge.id)}
          onRespond={(feedbackValue, isPositive) =>
            onRespond(nudge.id, feedbackValue, isPositive)
          }
        />
      ))}
    </section>
  );
}
