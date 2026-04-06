/* ──────────────────────────────────────────────────────────
   NorthStar — Mood logger component (Feature 5, opt-in)
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import type { MoodEntry } from "../types";
import "./MoodLogger.css";

export default function MoodLogger() {
  const { addMoodEntry, moodEntries } = useStore();
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const t = useT();

  const MOODS = [
    { level: 1 as const, emoji: "😞", label: t.mood.rough },
    { level: 2 as const, emoji: "😕", label: t.mood.low },
    { level: 3 as const, emoji: "😐", label: t.mood.okay },
    { level: 4 as const, emoji: "🙂", label: t.mood.good },
    { level: 5 as const, emoji: "😊", label: t.mood.great },
  ];

  const today = new Date().toISOString().split("T")[0];
  const todayEntry = moodEntries.find((e) => e.date === today);

  if (todayEntry) {
    const mood = MOODS.find((m) => m.level === todayEntry.level);
    return (
      <div className="mood-card card">
        <div className="mood-logged">
          <span className="mood-emoji-lg">{mood?.emoji}</span>
          <div>
            <p className="mood-logged-text">
              {t.mood.feeling(mood?.label?.toLowerCase() ?? "")}
            </p>
            {todayEntry.note && (
              <p className="mood-note-text">{todayEntry.note}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    if (selected === null) return;
    const entry: MoodEntry = {
      date: today,
      level: selected,
      note: note.trim() || undefined,
      timestamp: new Date().toISOString(),
    };
    addMoodEntry(entry);
    setNote("");
    setSelected(null);
  };

  return (
    <div className="mood-card card">
      <h4>{t.mood.howFeeling}</h4>
      <div className="mood-row">
        {MOODS.map((m) => (
          <button
            key={m.level}
            className={`mood-btn ${selected === m.level ? "selected" : ""}`}
            onClick={() => setSelected(m.level)}
          >
            <span className="mood-emoji">{m.emoji}</span>
            <span className="mood-label">{m.label}</span>
          </button>
        ))}
      </div>
      {selected !== null && (
        <div className="mood-note-area animate-fade-in">
          <input
            className="input"
            placeholder={t.mood.notePlaceholder}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
          />
          <button className="btn btn-primary btn-sm" onClick={handleSubmit}>
            {t.common.log}
          </button>
        </div>
      )}
    </div>
  );
}
