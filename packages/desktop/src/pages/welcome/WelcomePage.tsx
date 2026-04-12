/* ──────────────────────────────────────────────────────────
   NorthStar — Welcome page (first launch)
   ────────────────────────────────────────────────────────── */

import { ArrowRight } from "lucide-react";
import useStore from "../../store/useStore";
import { useT } from "../../i18n";
import "./WelcomePage.css";

export default function WelcomePage() {
  const setView = useStore((s) => s.setView);
  const t = useT();

  return (
    <div className="welcome">
      <div className="welcome-content animate-fade-in">
        <h1 className="welcome-title">
          {t.welcome.title}
        </h1>

        <p className="welcome-desc">
          {t.welcome.description.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i === 0 && <br />}
            </span>
          ))}
        </p>

        <div className="welcome-features">
          <div className="welcome-feature">
            <span className="welcome-feature-num">1</span>
            <span>{t.welcome.feature1}</span>
          </div>
          <div className="welcome-feature">
            <span className="welcome-feature-num">2</span>
            <span>{t.welcome.feature2}</span>
          </div>
          <div className="welcome-feature">
            <span className="welcome-feature-num">3</span>
            <span>{t.welcome.feature3}</span>
          </div>
        </div>

        <button
          className="btn btn-primary btn-lg welcome-cta"
          onClick={() => setView("onboarding")}
        >
          {t.welcome.getStarted}
          <ArrowRight size={18} />
        </button>

        <button
          className="btn btn-ghost welcome-skip"
          onClick={() => setView("tasks")}
        >
          {t.welcome.skipToDashboard}
        </button>

        <p className="welcome-note">
          {t.welcome.note}
        </p>
      </div>
    </div>
  );
}
