/* ──────────────────────────────────────────────────────────
   NorthStar — Settings page

   Phase 6a: reads user/settings/weeklyAvailability/behaviorProfile
   from `view:settings`. Mutations go through `command:update-settings`
   and `command:reset-data`. The ephemeral `setView` and local form
   state still live on the store / useState.
   ────────────────────────────────────────────────────────── */

import { useState, useEffect, useCallback } from "react";
import {
  Newspaper,
  RotateCcw,
  Save,
  Monitor,
  Brain,
  Sparkles,
  Trash2,
  Globe,
  User,
  Plus,
  X,
  Cpu,
  Clock,
  Loader2,
  AlertTriangle,
  RefreshCw,
  LogOut,
} from "lucide-react";
import { useAuth } from "../../contexts/AuthContext";
import useStore from "../../store/useStore";
import { useT, LANGUAGE_OPTIONS } from "../../i18n";
import type { Language } from "../../i18n";
import {
  triggerReflection,
  clearMemory,
  getBehaviorProfile,
  saveBehaviorProfile,
} from "../../services/memory";
import type { BehaviorProfileEntry } from "../../services/memory";
import { modelConfigRepo, memoryRepo } from "../../repositories";
import WeeklyAvailabilityGrid from "../../components/WeeklyAvailabilityGrid";
import type {
  TimeBlock,
  UserProfile,
  UserSettings,
  MemorySummary,
} from "@northstar/core";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import "./SettingsPage.css";

// MUST match packages/server/src/views/settingsView.ts
interface SettingsView {
  user: UserProfile | null;
  settings: UserSettings | null;
  weeklyAvailability: TimeBlock[];
  behaviorProfile: BehaviorProfileEntry[];
}

export default function SettingsPage() {
  const setView = useStore((s) => s.setView);
  const { user: authUser, signOut } = useAuth();
  const t = useT();
  const { data, loading, error, refetch } =
    useQuery<SettingsView>("view:settings");
  const { run } = useCommand();

  const [reflecting, setReflecting] = useState(false);
  const [reflectResult, setReflectResult] = useState<string | null>(null);

  // ── Memory summary (served via repo, not a view) ──
  const [memorySummary, setMemorySummary] = useState<MemorySummary | null>(null);
  const refreshMemorySummary = useCallback(async () => {
    try {
      const summary = await memoryRepo.getSummary();
      setMemorySummary(summary);
    } catch {
      // Ignore - memory is optional
    }
  }, []);
  useEffect(() => {
    refreshMemorySummary();
  }, [refreshMemorySummary]);

  // ── Behavior profile state ──
  const [profileEntries, setProfileEntries] = useState<BehaviorProfileEntry[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileDirty, setProfileDirty] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);

  // ── Model configuration state ──
  type ModelTier = "heavy" | "medium" | "light";
  type ClaudeModel =
    | "claude-opus-4-6"
    | "claude-sonnet-4-6"
    | "claude-haiku-4-5-20251001";
  const MODEL_LABELS: Record<ClaudeModel, string> = {
    "claude-opus-4-6": "Opus (most capable)",
    "claude-sonnet-4-6": "Sonnet (balanced)",
    "claude-haiku-4-5-20251001": "Haiku (fastest)",
  };
  const TIER_LABELS: Record<ModelTier, { label: string; desc: string }> = {
    heavy: { label: "Complex tasks", desc: "Goal plans, breakdowns, reallocation" },
    medium: { label: "Standard tasks", desc: "Daily tasks, chat, onboarding" },
    light: { label: "Simple tasks", desc: "Classification, quick analysis, reflection" },
  };

  const [modelConfig, setModelConfig] = useState<{
    tiers: Record<ModelTier, ClaudeModel>;
    tasks: Record<string, ModelTier>;
    availableModels: ClaudeModel[];
  } | null>(null);
  const [modelSaved, setModelSaved] = useState(false);

  // ── Availability state (seeded from view) ──
  const [availability, setAvailability] = useState<TimeBlock[]>([]);
  const [availabilityDirty, setAvailabilityDirty] = useState(false);
  const [availabilitySaved, setAvailabilitySaved] = useState(false);

  // Seed availability from the server view once, and re-seed whenever the
  // view updates, UNLESS the user has local dirty edits pending.
  useEffect(() => {
    if (!data) return;
    if (availabilityDirty) return;
    setAvailability(data.weeklyAvailability || []);
  }, [data, availabilityDirty]);

  const handleAvailabilityChange = (next: TimeBlock[]) => {
    setAvailability(next);
    setAvailabilityDirty(true);
  };

  const handleSaveAvailability = async () => {
    // weeklyAvailability lives on UserProfile, not UserSettings. The
    // current protocol has no dedicated command for it; we piggy-back
    // on `command:update-settings` so the server can merge it into the
    // user row. Follow-up: introduce `command:update-profile`.
    await run("command:update-settings", {
      settings: { weeklyAvailability: availability } as unknown as Partial<UserSettings>,
    });
    setAvailabilityDirty(false);
    setAvailabilitySaved(true);
    setTimeout(() => setAvailabilitySaved(false), 2000);
    refetch();
  };

  useEffect(() => {
    modelConfigRepo
      .get()
      .then((config) => {
        setModelConfig(config as typeof modelConfig);
      })
      .catch(() => {});
  }, []);

  const handleUpdateSettings = async (patch: Partial<UserSettings>) => {
    await run("command:update-settings", { settings: patch });
    refetch();
  };

  const handleModelTierChange = async (tier: ModelTier, model: ClaudeModel) => {
    if (!modelConfig) return;
    const newTiers = { ...modelConfig.tiers, [tier]: model };
    setModelConfig({ ...modelConfig, tiers: newTiers });
    await modelConfigRepo.setOverrides(newTiers);
    // Also persist in user settings so it survives restarts
    await handleUpdateSettings({ modelOverrides: newTiers } as Partial<UserSettings>);
    setModelSaved(true);
    setTimeout(() => setModelSaved(false), 2000);
  };

  const PROFILE_CATEGORIES = [
    "Schedule",
    "Preferences",
    "Work capacity",
    "Motivation",
    "Patterns",
    "Constraints",
    "Strengths",
    "Struggles",
  ];

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    try {
      const res = await getBehaviorProfile();
      if (res.ok && res.data) {
        setProfileEntries(res.data);
      }
    } catch {
      // Ignore errors — profile is optional
    } finally {
      setProfileLoading(false);
      setProfileLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!profileLoaded) loadProfile();
  }, [profileLoaded, loadProfile]);

  // Loading + error states for the view fetch itself.
  if (loading && !data) {
    return (
      <div className="settings-empty">
        <Loader2 size={18} className="spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-empty">
        <AlertTriangle size={18} />
        <p>{error.message}</p>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const user = data.user;
  const settings = data.settings;

  if (!user) {
    return (
      <div className="settings-empty">
        <p>{t.settings.noUser}</p>
        <button className="btn btn-primary" onClick={() => setView("welcome")}>
          {t.settings.getStarted}
        </button>
      </div>
    );
  }

  const handleReset = async () => {
    if (window.confirm(t.settings.resetConfirm)) {
      await run("command:reset-data", {});
      clearMemory();
      refreshMemorySummary();
      refetch();
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-scroll">
        <h2 className="animate-fade-in">{t.settings.title}</h2>

        {/* AI Model Configuration */}
        {modelConfig && (
          <section className="settings-section card animate-fade-in">
            <div className="settings-section-header">
              <Cpu size={18} />
              <h3>AI Model Tiers</h3>
            </div>
            <p className="settings-desc">
              Assign different Claude models to different task types. Use Opus for complex planning, Haiku for fast simple tasks, or Sonnet for everything.
              {modelSaved && <span className="settings-saved-inline"> Saved!</span>}
            </p>
            {(Object.keys(TIER_LABELS) as ModelTier[]).map((tier) => (
              <div key={tier} className="model-tier-row">
                <div className="model-tier-info">
                  <span className="model-tier-label">{TIER_LABELS[tier].label}</span>
                  <span className="model-tier-desc">{TIER_LABELS[tier].desc}</span>
                </div>
                <select
                  className="model-tier-select"
                  value={modelConfig.tiers[tier]}
                  onChange={(e) => handleModelTierChange(tier, e.target.value as ClaudeModel)}
                >
                  {modelConfig.availableModels.map((m) => (
                    <option key={m} value={m}>{MODEL_LABELS[m]}</option>
                  ))}
                </select>
              </div>
            ))}
          </section>
        )}

        {/* Weekly Availability */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <Clock size={18} />
            <h3>Weekly Availability</h3>
          </div>
          <p className="settings-desc">
            Select the time blocks when you're free to work on goals. This directly affects how many tasks the AI assigns each day.
            {availabilitySaved && <span className="settings-saved-inline"> Saved!</span>}
          </p>
          <WeeklyAvailabilityGrid value={availability} onChange={handleAvailabilityChange} />
          <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn btn-primary" onClick={handleSaveAvailability}>
              <Save size={14} /> Save Availability
            </button>
            <span className="settings-desc" style={{ margin: 0 }}>
              {availability.length} block{availability.length !== 1 ? "s" : ""} selected
            </span>
          </div>
        </section>

        {/* Opt-in Features */}
        <section className="settings-section card animate-fade-in">
          <h3>{t.settings.optionalTitle}</h3>
          <p className="settings-desc">
            {t.settings.optionalDesc}
          </p>

          <div className="toggle-row">
            <div className="toggle-info">
              <Newspaper size={16} />
              <div>
                <span className="toggle-label">{t.settings.newsFeed}</span>
                <span className="toggle-desc">
                  {t.settings.newsFeedDesc}
                </span>
              </div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings?.enableNewsFeed || false}
                onChange={(e) =>
                  handleUpdateSettings({ enableNewsFeed: e.target.checked })
                }
              />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="toggle-row" style={{ marginTop: "var(--space-md)" }}>
            <div className="toggle-text">
              <span className="toggle-label">Daily task refresh time</span>
              <span className="toggle-desc">
                When your daily tasks auto-generate each day
              </span>
            </div>
            <input
              type="time"
              className="input input-sm"
              value={settings?.dailyTaskRefreshTime ?? "06:00"}
              onChange={(e) =>
                handleUpdateSettings({ dailyTaskRefreshTime: e.target.value })
              }
              style={{ width: 110 }}
            />
          </div>
        </section>

        {/* Calendar & Integrations */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <Monitor size={18} />
            <h3>{t.settings.calendarTitle}</h3>
          </div>
          <p className="settings-desc">
            {t.settings.calendarDesc}
          </p>
          <button className="btn btn-secondary" onClick={() => setView("calendar")}>
            <Monitor size={14} />
            {t.settings.openCalendar}
          </button>
        </section>

        {/* AI Memory */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <Brain size={18} />
            <h3>{t.settings.memoryTitle}</h3>
          </div>
          <p className="settings-desc">
            {t.settings.memoryDesc}
          </p>

          {memorySummary ? (
            <div className="memory-stats">
              <div className="memory-stat-row">
                <span className="memory-stat-label">{t.settings.factsLearned}</span>
                <span className="memory-stat-value">{memorySummary.totalFacts}</span>
              </div>
              <div className="memory-stat-row">
                <span className="memory-stat-label">{t.settings.preferencesDetected}</span>
                <span className="memory-stat-value">{memorySummary.totalPreferences}</span>
              </div>
              <div className="memory-stat-row">
                <span className="memory-stat-label">{t.settings.behavioralSignals}</span>
                <span className="memory-stat-value">{memorySummary.totalSignals}</span>
              </div>
              <div className="memory-stat-row">
                <span className="memory-stat-label">{t.settings.reflectionCycles}</span>
                <span className="memory-stat-value">{memorySummary.reflectionCount}</span>
              </div>

              {memorySummary.highConfidenceFacts.length > 0 && (
                <div className="memory-facts">
                  <h4>{t.settings.whatAiKnows}</h4>
                  {memorySummary.highConfidenceFacts.map((f, i) => (
                    <div key={i} className="memory-fact-item">
                      <span className="memory-fact-category">{f.category}</span>
                      <span className="memory-fact-text">{f.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {memorySummary.topPreferences.length > 0 && (
                <div className="memory-prefs">
                  <h4>{t.settings.detectedPreferences}</h4>
                  {memorySummary.topPreferences.map((p, i) => (
                    <div key={i} className="memory-pref-item">
                      <span className={`memory-pref-badge ${p.sentiment}`}>
                        {p.sentiment === "positive" ? "👍" : p.sentiment === "negative" ? "👎" : "↔️"}
                      </span>
                      <span>{p.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="settings-desc" style={{ fontStyle: "italic" }}>
              {t.settings.noMemory}
            </p>
          )}

          <div className="memory-actions">
            <button
              className="btn btn-secondary"
              disabled={reflecting}
              onClick={async () => {
                setReflecting(true);
                setReflectResult(null);
                try {
                  const res = await triggerReflection("manual_settings_page");
                  if (res.ok && res.data) {
                    setReflectResult(
                      res.data.newInsights > 0
                        ? `${t.settings.newInsights(res.data.newInsights)}${
                            res.data.proactiveQuestion
                              ? ` Question: "${res.data.proactiveQuestion}"`
                              : ""
                          }`
                        : t.settings.noPatterns
                    );
                    refreshMemorySummary();
                  } else {
                    setReflectResult(t.settings.reflectionNeedsKey);
                  }
                } catch {
                  setReflectResult(t.settings.reflectionFailed);
                }
                setReflecting(false);
              }}
            >
              <Sparkles size={14} />
              {reflecting ? t.settings.reflecting : t.settings.runReflection}
            </button>

            <button
              className="btn btn-secondary settings-reset-btn"
              onClick={async () => {
                if (window.confirm(t.settings.clearMemoryConfirm)) {
                  await clearMemory();
                  refreshMemorySummary();
                  setReflectResult(t.settings.memoryCleared);
                }
              }}
            >
              <Trash2 size={14} />
              {t.settings.clearMemory}
            </button>
          </div>

          {reflectResult && (
            <p className="memory-reflect-result">{reflectResult}</p>
          )}
        </section>

        {/* Behavior Profile */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <User size={18} />
            <h3>{t.settings.behaviorProfileTitle}</h3>
          </div>
          <p className="settings-desc">
            {t.settings.behaviorProfileDesc}
          </p>

          {profileLoading && (
            <p className="settings-desc" style={{ fontStyle: "italic" }}>
              {t.settings.behaviorProfileLoading}
            </p>
          )}

          {!profileLoading && profileEntries.length === 0 && (
            <p className="settings-desc" style={{ fontStyle: "italic" }}>
              {t.settings.behaviorProfileEmpty}
            </p>
          )}

          {!profileLoading && profileEntries.length > 0 && (
            <div className="behavior-profile-list">
              {profileEntries.map((entry, i) => (
                <div key={entry.id} className="behavior-profile-entry">
                  <div className="behavior-profile-entry-header">
                    <select
                      className="input behavior-profile-category-select"
                      value={entry.category}
                      onChange={(e) => {
                        const updated = [...profileEntries];
                        updated[i] = { ...updated[i], category: e.target.value };
                        setProfileEntries(updated);
                        setProfileDirty(true);
                      }}
                    >
                      {PROFILE_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {(t.settings.behaviorProfileCategories as Record<string, string>)[cat] || cat}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn btn-ghost btn-sm behavior-profile-remove"
                      onClick={() => {
                        setProfileEntries(profileEntries.filter((_, j) => j !== i));
                        setProfileDirty(true);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <input
                    className="input behavior-profile-text"
                    value={entry.text}
                    onChange={(e) => {
                      const updated = [...profileEntries];
                      updated[i] = { ...updated[i], text: e.target.value, source: "user-edited" };
                      setProfileEntries(updated);
                      setProfileDirty(true);
                    }}
                    placeholder="Describe a pattern or preference..."
                  />
                  {entry.source === "observed" && (
                    <span className="behavior-profile-badge">AI observed</span>
                  )}
                  {entry.source === "user-edited" && (
                    <span className="behavior-profile-badge behavior-profile-badge--edited">You edited</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="behavior-profile-actions">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setProfileEntries([
                  ...profileEntries,
                  {
                    id: `new-${Date.now()}`,
                    category: "Preferences",
                    text: "",
                    source: "user-edited",
                  },
                ]);
                setProfileDirty(true);
              }}
            >
              <Plus size={14} />
              {t.settings.behaviorProfileAdd}
            </button>

            {profileDirty && (
              <button
                className="btn btn-primary"
                onClick={async () => {
                  // Only save entries that have text
                  const toSave = profileEntries
                    .filter((e) => e.text.trim())
                    .map((e) => ({ category: e.category, text: e.text.trim() }));
                  await saveBehaviorProfile(toSave);
                  setProfileDirty(false);
                  setProfileSaved(true);
                  // Refresh memory summary since we changed facts
                  refreshMemorySummary();
                  setTimeout(() => setProfileSaved(false), 3000);
                }}
              >
                <Save size={14} />
                {t.settings.behaviorProfileSave}
              </button>
            )}
          </div>

          {profileSaved && (
            <p className="behavior-profile-saved">{t.settings.behaviorProfileSaved}</p>
          )}
        </section>

        {/* Language */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <Globe size={18} />
            <h3>{t.settings.languageTitle}</h3>
          </div>
          <p className="settings-desc">
            {t.settings.languageDesc}
          </p>
          <div className="toggle-row">
            <div className="toggle-info">
              <Globe size={16} />
              <div>
                <span className="toggle-label">{t.settings.languageLabel}</span>
              </div>
            </div>
            <select
              className="input settings-language-select"
              value={settings?.language || "en"}
              onChange={(e) => handleUpdateSettings({ language: e.target.value as Language })}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.nativeLabel} ({opt.label})
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Account / Sign Out */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <LogOut size={18} />
            <h3>Account</h3>
          </div>
          {authUser?.email && (
            <p className="settings-desc">
              {t.auth.signedInAs} <strong>{authUser.email}</strong>
            </p>
          )}
          <button className="btn btn-secondary settings-reset-btn" onClick={signOut}>
            <LogOut size={14} />
            {t.auth.signOut}
          </button>
        </section>

        {/* Reset */}
        <section className="settings-section card animate-fade-in settings-danger">
          <div className="settings-section-header">
            <RotateCcw size={18} />
            <h3>{t.settings.resetTitle}</h3>
          </div>
          <p className="settings-desc">
            {t.settings.resetDesc}
          </p>
          <button className="btn btn-secondary settings-reset-btn" onClick={handleReset}>
            <RotateCcw size={14} />
            {t.settings.resetBtn}
          </button>
        </section>
      </div>
    </div>
  );
}
