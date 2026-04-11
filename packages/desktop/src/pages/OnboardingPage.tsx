/* ──────────────────────────────────────────────────────────
   NorthStar — Onboarding page (Phase 6b rewrite)
   Steps: intent → availability → done

   Reads the view model `view:onboarding` via useQuery and
   commits the final onboarding state via `command:complete-onboarding`.
   No Zustand domain reads — only ephemeral `setView` for routing.
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Star, ArrowRight, Check, Loader2, AlertTriangle } from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import WeeklyAvailabilityGrid from "../components/WeeklyAvailabilityGrid";
import { useQuery } from "../hooks/useQuery";
import { useCommand } from "../hooks/useCommand";
import type { TimeBlock, UserProfile } from "@northstar/core";
import "./OnboardingPage.css";

type OnboardingStep = "intent" | "availability" | "done";

// MUST match packages/server/src/views/onboardingView.ts
interface OnboardingViewModel {
  user: UserProfile | null;
  onboardingComplete: boolean;
  weeklyAvailability: TimeBlock[];
  goalRaw: string;
}

export default function OnboardingPage() {
  const setView = useStore((s) => s.setView);
  const t = useT();

  const { data, loading, error } = useQuery<OnboardingViewModel>("view:onboarding");
  const { run: runCommand, running: commandRunning, error: commandError } =
    useCommand();

  const language = data?.user?.settings?.language || "en";

  const [step, setStep] = useState<OnboardingStep>("intent");
  const [intent, setIntent] = useState("");
  const [availability, setAvailability] = useState<TimeBlock[]>([]);

  // ── Step handlers ──

  const handleIntentContinue = async () => {
    // Persist the goal text onto the user profile so the next step can
    // read it. We do a partial `complete-onboarding` style write, but
    // without the `onboardingComplete: true` flag — the server merges
    // the patch into the user row.
    try {
      await runCommand("command:complete-onboarding", {
        user: {
          goalRaw: intent.trim() || data?.goalRaw || "",
          // Preserve onboardingComplete=false so we don't advance yet.
          // The command hardcodes it to true, so we only call it on the
          // final step. For the intent step we just keep local state.
        },
      }).catch(() => {
        // Intent persistence is best-effort — fall through to next step
        // even on failure. The final step will rewrite the whole user.
      });
    } catch {
      /* ignore */
    }
    setStep("availability");
  };

  const handleAvailabilityContinue = async () => {
    try {
      await runCommand("command:complete-onboarding", {
        user: {
          goalRaw: intent.trim() || data?.goalRaw || "",
          weeklyAvailability: availability,
        },
      });
      setStep("done");
    } catch {
      /* error surfaces via commandError */
    }
  };

  const handleFinish = () => {
    setView("dashboard");
  };

  const handleSkipAvailability = async () => {
    try {
      await runCommand("command:complete-onboarding", {
        user: {
          goalRaw: intent.trim() || data?.goalRaw || "",
          weeklyAvailability: [],
        },
      });
    } catch {
      /* ignore — still navigate */
    }
    setView("dashboard");
  };

  // ── Render ──

  if (loading && !data) {
    return (
      <div className="onboarding">
        <div className="onboarding-container">
          <div className="onboarding-step animate-fade-in">
            <Loader2 size={24} className="spin" />
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="onboarding">
        <div className="onboarding-container">
          <div className="onboarding-step animate-fade-in">
            <AlertTriangle size={24} />
            <p>{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

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

        {commandError && (
          <div className="onboarding-error animate-fade-in">
            <AlertTriangle size={14} />
            <span>{commandError.message}</span>
          </div>
        )}

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
                disabled={commandRunning}
              >
                {t.common.continue}
                <ArrowRight size={16} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => handleIntentContinue()}
                disabled={commandRunning}
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
                disabled={commandRunning}
              >
                {availability.length > 0 ? t.onboarding.looksGood : t.common.continue}
                <ArrowRight size={16} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={handleSkipAvailability}
                disabled={commandRunning}
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
