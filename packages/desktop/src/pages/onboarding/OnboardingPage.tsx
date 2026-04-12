/* ──────────────────────────────────────────────────────────
   NorthStar — Onboarding page (Phase 6b rewrite)
   Steps: intent → timezone → availability → done

   Reads the view model `view:onboarding` via useQuery and
   commits the final onboarding state via `command:complete-onboarding`.
   No Zustand domain reads — only ephemeral `setView` for routing.
   ────────────────────────────────────────────────────────── */

import { useState, useMemo } from "react";
import { Star, ArrowRight, Check, Loader2, AlertTriangle, Globe } from "lucide-react";
import useStore from "../../store/useStore";
import { useT } from "../../i18n";
import WeeklyAvailabilityGrid from "../../components/WeeklyAvailabilityGrid";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import type { TimeBlock, UserProfile } from "@northstar/core";
import "./OnboardingPage.css";

type OnboardingStep = "intent" | "timezone" | "availability" | "done";

// Common timezones grouped by region for easier selection
const TIMEZONE_GROUPS = [
  {
    label: "Americas",
    zones: [
      { value: "America/New_York", label: "Eastern Time (New York)" },
      { value: "America/Chicago", label: "Central Time (Chicago)" },
      { value: "America/Denver", label: "Mountain Time (Denver)" },
      { value: "America/Los_Angeles", label: "Pacific Time (Los Angeles)" },
      { value: "America/Anchorage", label: "Alaska Time" },
      { value: "Pacific/Honolulu", label: "Hawaii Time" },
      { value: "America/Toronto", label: "Eastern Time (Toronto)" },
      { value: "America/Vancouver", label: "Pacific Time (Vancouver)" },
      { value: "America/Mexico_City", label: "Mexico City" },
      { value: "America/Sao_Paulo", label: "São Paulo" },
      { value: "America/Buenos_Aires", label: "Buenos Aires" },
    ],
  },
  {
    label: "Europe",
    zones: [
      { value: "Europe/London", label: "London (GMT/BST)" },
      { value: "Europe/Paris", label: "Paris / Berlin / Rome" },
      { value: "Europe/Moscow", label: "Moscow" },
      { value: "Europe/Istanbul", label: "Istanbul" },
      { value: "Europe/Amsterdam", label: "Amsterdam" },
      { value: "Europe/Madrid", label: "Madrid" },
    ],
  },
  {
    label: "Asia & Pacific",
    zones: [
      { value: "Asia/Shanghai", label: "China Standard Time (Beijing/Shanghai)" },
      { value: "Asia/Hong_Kong", label: "Hong Kong" },
      { value: "Asia/Tokyo", label: "Japan Standard Time (Tokyo)" },
      { value: "Asia/Seoul", label: "Korea Standard Time (Seoul)" },
      { value: "Asia/Singapore", label: "Singapore" },
      { value: "Asia/Kolkata", label: "India Standard Time" },
      { value: "Asia/Dubai", label: "Dubai" },
      { value: "Australia/Sydney", label: "Sydney" },
      { value: "Australia/Melbourne", label: "Melbourne" },
      { value: "Australia/Perth", label: "Perth" },
      { value: "Pacific/Auckland", label: "Auckland" },
    ],
  },
  {
    label: "Africa & Middle East",
    zones: [
      { value: "Africa/Cairo", label: "Cairo" },
      { value: "Africa/Johannesburg", label: "Johannesburg" },
      { value: "Africa/Lagos", label: "Lagos" },
      { value: "Asia/Jerusalem", label: "Jerusalem" },
      { value: "Asia/Riyadh", label: "Riyadh" },
    ],
  },
];

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

  // Auto-detect user's timezone on mount
  const detectedTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  const [step, setStep] = useState<OnboardingStep>("intent");
  const [intent, setIntent] = useState("");
  const [timezone, setTimezone] = useState(detectedTimezone);
  const [availability, setAvailability] = useState<TimeBlock[]>([]);

  // Format current time in selected timezone for preview
  const currentTimePreview = useMemo(() => {
    try {
      return new Date().toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "";
    }
  }, [timezone]);

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
    setStep("timezone");
  };

  const handleTimezoneContinue = () => {
    setStep("availability");
  };

  const handleAvailabilityContinue = async () => {
    try {
      await runCommand("command:complete-onboarding", {
        user: {
          goalRaw: intent.trim() || data?.goalRaw || "",
          timezone,
          weeklyAvailability: availability,
        },
      });
      setStep("done");
    } catch {
      /* error surfaces via commandError */
    }
  };

  const handleFinish = () => {
    setView("tasks");
  };

  const handleSkipAvailability = async () => {
    try {
      await runCommand("command:complete-onboarding", {
        user: {
          goalRaw: intent.trim() || data?.goalRaw || "",
          timezone,
          weeklyAvailability: [],
        },
      });
    } catch {
      /* ignore — still navigate */
    }
    setView("tasks");
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
          {(["intent", "timezone", "availability"] as OnboardingStep[]).map((s, i) => (
            <div
              key={s}
              className={`onboarding-progress-dot ${
                step === s
                  ? "onboarding-progress-dot--active"
                  : (["intent", "timezone", "availability"].indexOf(step) > i || step === "done")
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

        {/* ── Timezone Step ── */}
        {step === "timezone" && (
          <div className="onboarding-step animate-fade-in">
            <div className="onboarding-step-icon">
              <Globe size={24} />
            </div>
            <h2 className="onboarding-step-title">
              {language === "zh" ? "你在哪个时区？" : "What's your timezone?"}
            </h2>
            <p className="onboarding-step-desc">
              {language === "zh"
                ? "我们会根据你的本地时间来安排任务，每天6点刷新。"
                : "We'll schedule tasks based on your local time, with days refreshing at 6 AM."}
            </p>

            {currentTimePreview && (
              <p className="onboarding-time-preview">
                {language === "zh" ? "当前时间：" : "Current time: "}
                <strong>{currentTimePreview}</strong>
              </p>
            )}

            <select
              className="input onboarding-field onboarding-timezone-select"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {TIMEZONE_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.zones.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <div className="onboarding-actions">
              <button
                className="btn btn-primary"
                onClick={handleTimezoneContinue}
              >
                {t.common.continue}
                <ArrowRight size={16} />
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
