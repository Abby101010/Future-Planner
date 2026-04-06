/* ──────────────────────────────────────────────────────────
   NorthStar — Settings page
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Key, Heart, Newspaper, RotateCcw, Save, Monitor, Brain, Sparkles, Trash2, Globe } from "lucide-react";
import useStore from "../store/useStore";
import { useT, LANGUAGE_OPTIONS } from "../i18n";
import type { Language } from "../i18n";
import { triggerReflection, clearMemory } from "../services/memory";
import "./SettingsPage.css";

export default function SettingsPage() {
  const { user, updateSettings, setView, setRoadmap, setGoalBreakdown, setCalendarEvents, memorySummary, refreshMemorySummary } = useStore();
  const settings = user?.settings;
  const t = useT();

  const [apiKey, setApiKey] = useState(settings?.apiKey || "");
  const [saved, setSaved] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [reflectResult, setReflectResult] = useState<string | null>(null);

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

  const handleSaveKey = () => {
    updateSettings({ apiKey: apiKey.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = async () => {
    if (window.confirm(t.settings.resetConfirm)) {
      await useStore.getState().resetGoalData();
      clearMemory();
      setView("dashboard");
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-scroll">
        <h2 className="animate-fade-in">{t.settings.title}</h2>

        {/* API Key */}
        <section className="settings-section card animate-fade-in">
          <div className="settings-section-header">
            <Key size={18} />
            <h3>{t.settings.apiKeyTitle}</h3>
          </div>
          <p className="settings-desc">
            {t.settings.apiKeyDesc}
          </p>
          <div className="settings-input-row">
            <input
              type="password"
              className="input"
              placeholder="sk-ant-api03-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleSaveKey}>
              <Save size={14} />
              {saved ? t.common.saved : t.common.save}
            </button>
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
              <Heart size={16} />
              <div>
                <span className="toggle-label">{t.settings.moodTracking}</span>
                <span className="toggle-desc">
                  {t.settings.moodTrackingDesc}
                </span>
              </div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={settings?.enableMoodLogging || false}
                onChange={(e) =>
                  updateSettings({ enableMoodLogging: e.target.checked })
                }
              />
              <span className="toggle-slider" />
            </label>
          </div>

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
                  updateSettings({ enableNewsFeed: e.target.checked })
                }
              />
              <span className="toggle-slider" />
            </label>
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
              onChange={(e) => updateSettings({ language: e.target.value as Language })}
            >
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.nativeLabel} ({opt.label})
                </option>
              ))}
            </select>
          </div>
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
