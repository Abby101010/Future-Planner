/* ──────────────────────────────────────────────────────────
   NorthStar — Onboarding page (redesigned)
   Steps: intent → availability → done

   The Anthropic API key now lives server-side as ANTHROPIC_API_KEY
   (Fly secret) — users no longer need to bring their own key.
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Star, ArrowRight, Check } from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import WeeklyAvailabilityGrid from "../components/WeeklyAvailabilityGrid";
import { entitiesRepo } from "../repositories";
import type { TimeBlock } from "../types";
import "./OnboardingPage.css";

type OnboardingStep = "intent" | "availability" | "done";

export default function OnboardingPage() {
  const { setUser, setView, user } = useStore();
  const t = useT();

  const [step, setStep] = useState<OnboardingStep>("intent");
  const [intent, setIntent] = useState("");
  const [availability, setAvailability] = useState<TimeBlock[]>([]);

  const language = user?.settings?.language || "en";

  // ── Step handlers ──

  const handleIntentContinue = async () => {
    const newUser =
      user ||
      (await entitiesRepo.newUser({
        name: "",
        goalRaw: "",
        settings: {
          enableNewsFeed: false,
          theme: "light",
          language: "en",
        },
      }));
    setUser({ ...newUser, goalRaw: intent.trim() || newUser.goalRaw });
    setStep("availability");
  };

  const handleAvailabilityContinue = () => {
    if (!user) return;
    setUser({
      ...user,
      weeklyAvailability: availability,
      onboardingComplete: true,
    });
    setStep("done");
  };

  const handleFinish = () => {
    setView("dashboard");
  };

  const handleSkipAvailability = () => {
    if (!user) return;
    setUser({
      ...user,
      weeklyAvailability: [],
      onboardingComplete: true,
    });
    setView("dashboard");
  };

  // ── Render ──

  return (
    <div className="onboarding">
      <div className="onboarding-container">
        {/* Progress dots */}
        <div className="onboarding-progress">
          {(["intent", "availability"] as OnboardingStep[]).map((s, i) => (
            <div
              key={s}
              className={`onboarding-progress-dot ${
                step === s
                  ? "onboarding-progress-dot--active"
                  : (["intent", "availability"].indexOf(step) > i || step === "done")
                    ? "onboarding-progress-dot--done"
                    : ""
              }`}
            />
          ))}
        </div>

        {/* ── Intent Step ── */}
        {step === "intent" && (
          <div className="onboarding-step animate-fade-in">
            <div className="onboarding-step-icon">
              <Star size={24} />
            </div>
            <h2 className="onboarding-step-title">{t.onboarding.intentTitle}</h2>
            <p className="onboarding-step-desc">{t.onboarding.intentDesc}</p>

            <textarea
              className="input onboarding-field onboarding-textarea"
              placeholder={t.onboarding.intentPlaceholder}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={3}
            />

            <div className="onboarding-actions">
              <button
                className="btn btn-primary"
                onClick={handleIntentContinue}
              >
                {t.common.continue}
                <ArrowRight size={16} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => handleIntentContinue()}
              >
                {t.onboarding.skipForNow}
              </button>
            </div>
          </div>
        )}

        {/* ── Availability Step ── */}
        {step === "availability" && (
          <div className="onboarding-step onboarding-step--wide animate-fade-in">
            <h2 className="onboarding-step-title">{t.onboarding.availabilityTitle}</h2>
            <p className="onboarding-step-desc">{t.onboarding.availabilityDesc}</p>

            <div className="onboarding-grid-container">
              <WeeklyAvailabilityGrid
                value={availability}
                onChange={setAvailability}
                language={language}
              />
            </div>

            <div className="onboarding-actions">
              <button
                className="btn btn-primary"
                onClick={handleAvailabilityContinue}
              >
                {availability.length > 0 ? t.onboarding.looksGood : t.common.continue}
                <ArrowRight size={16} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={handleSkipAvailability}
              >
                {t.onboarding.skipForNow}
              </button>
            </div>
          </div>
        )}

        {/* ── Done Step ── */}
        {step === "done" && (
          <div className="onboarding-step animate-fade-in">
            <div className="onboarding-step-icon onboarding-step-icon--done">
              <Check size={24} />
            </div>
            <h2 className="onboarding-step-title">{t.onboarding.doneTitle}</h2>
            <p className="onboarding-step-desc">{t.onboarding.doneDesc}</p>

            <div className="onboarding-summary">
              {intent && (
                <div className="onboarding-summary-item">
                  <span className="onboarding-summary-label">{t.onboarding.yourGoal}</span>
                  <span className="onboarding-summary-value">{intent}</span>
                </div>
              )}
              {availability.length > 0 && (
                <div className="onboarding-summary-item">
                  <span className="onboarding-summary-label">{t.onboarding.timeBlocks}</span>
                  <span className="onboarding-summary-value">
                    {availability.length} {language === "zh" ? "个时间块已选择" : "blocks selected"}
                  </span>
                </div>
              )}
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={handleFinish}
            >
              {t.onboarding.goToDashboard}
              <ArrowRight size={18} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
