/* ──────────────────────────────────────────────────────────
   NorthStar — Three-Tier Memory Architecture
   
   Layer 1: Short-Term  — Conversation buffer (per-session)
   Layer 2: Long-Term   — Structured facts about the user
   Layer 3: Semantic    — Preference vectors & feedback patterns
   
   All data persists locally in the user's app data folder.
   No external services required.
   
   Architecture: Service-oriented classes with index-backed
   lookups for O(1) fact/preference retrieval.
   ────────────────────────────────────────────────────────── */

import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  loadMemoryFromDB,
  dbUpsertFact,
  dbUpsertPreference,
  dbUpsertPreferenceWithEmbedding,
  searchSimilarPreferences,
  dbInsertSignal,
  dbUpsertSnooze,
  dbInsertTaskTiming,
  dbUpdateReflectionMeta,
  dbClearMemory,
} from "./database";

// ── Interfaces ──────────────────────────────────────────

/** A structured fact the AI has learned about the user */
export interface LongTermFact {
  id: string;
  category: FactCategory;
  key: string;            // e.g. "preferred_work_time"
  value: string;          // e.g. "morning, before 10 AM"
  confidence: number;     // 0-1, increases with repeated evidence
  evidence: string[];     // what led to this conclusion
  createdAt: string;
  updatedAt: string;
  source: "reflection" | "explicit" | "behavioral"; // how we learned it
}

export type FactCategory =
  | "schedule"       // when they work, sleep, are busy
  | "preference"     // likes/dislikes about planning style
  | "capacity"       // how much they can realistically do
  | "motivation"     // what drives/demotivates them
  | "pattern"        // recurring behavioral patterns
  | "constraint"     // hard limits (job hours, family, health)
  | "strength"       // what they're good at / respond well to
  | "struggle";      // what they consistently find hard

/** A semantic preference — the "vibe" layer */
export interface SemanticPreference {
  id: string;
  text: string;          // natural language description
  tags: string[];        // searchable tags for cosine-like matching
  weight: number;        // -1 (strong dislike) to +1 (strong like)
  frequency: number;     // how many times this pattern appeared
  examples: string[];    // concrete instances
  createdAt: string;
  updatedAt: string;
}

/** Behavioral signal captured from user actions */
export interface BehavioralSignal {
  id: string;
  type: SignalType;
  context: string;       // what was happening
  value: string;         // the specific observation
  timestamp: string;
}

export type SignalType =
  | "task_completed"
  | "task_snoozed"
  | "task_skipped"
  | "task_completed_early"
  | "task_completed_late"
  | "recovery_triggered"
  | "blocker_reported"
  | "schedule_override"
  | "positive_feedback"
  | "negative_feedback"
  | "session_time"       // when they open the app
  | "high_energy_window" // when they crush tasks
  | "low_energy_window"  // when they skip/snooze (with day+time context)
  | "chat_insight";      // key behavioral takeaway from home chat

/** Snooze tracking for implicit feedback */
export interface SnoozeRecord {
  taskTitle: string;
  taskCategory: string;
  snoozeCount: number;
  originalDate: string;
  lastSnoozed: string;
}

/** Task timing stats for duration calibration */
export interface TaskTimingRecord {
  taskCategory: string;
  taskKeywords: string[];  // extracted from title
  estimatedMinutes: number;
  actualMinutes: number;
  date: string;
}

/** The complete memory store */
export interface MemoryStore {
  // Layer 2: Long-term structured facts
  facts: LongTermFact[];
  
  // Layer 3: Semantic preferences
  preferences: SemanticPreference[];
  
  // Behavioral tracking (raw signals, pre-reflection)
  signals: BehavioralSignal[];
  snoozeRecords: SnoozeRecord[];
  taskTimings: TaskTimingRecord[];
  
  // Meta
  lastReflectionAt: string | null;
  reflectionCount: number;
  version: number;
}

// ── MemoryManager — OOP service with indexed lookups ────
//
// Instead of scanning arrays on every call, this class
// builds hash-map indices for O(1) access patterns:
//   factIndex:   Map<"category:key", index>   — O(1) upsert
//   prefTagIndex: Map<tag, Set<index>>         — O(k) query (k = matching tags)
//   snoozeIndex:  Map<"title:date", index>     — O(1) snooze lookup
//   signalTypeIndex: Map<SignalType, index[]>  — O(1) type-based filtering
//
// All indices are rebuilt once on load and maintained
// incrementally during mutations.

export class MemoryManager {
  private store: MemoryStore;
  private dirty = false;
  private savePath: string;
  private _dbReady = false;

  // ── Indices ──
  private factIndex = new Map<string, number>();        // "category:key" → index
  private prefTagIndex = new Map<string, Set<number>>(); // tag → set of pref indices
  private snoozeIndex = new Map<string, number>();       // "title:date" → index
  private signalsByType = new Map<SignalType, number[]>(); // type → signal indices
  private signalsByHour = new Map<number, { completed: number; skipped: number }>();

  constructor(storePath?: string) {
    this.savePath = storePath ?? getMemoryPath();
    // Start with JSON as fallback; DB takes over once loadFromDB() resolves
    this.store = this.loadFromDisk();
    this.rebuildIndices();
  }

  // ── Persistence ───────────────────────────────────────

  /** Load memory from DB into the in-memory store + indexes.
   *  Call once after construction (async). */
  async loadFromDB(): Promise<void> {
    try {
      const raw = await loadMemoryFromDB();
      const store = createEmptyStore();

      store.facts = raw.facts.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        category: r.category as FactCategory,
        key: r.key as string,
        value: r.value as string,
        confidence: r.confidence as number,
        evidence: (r.evidence || []) as string[],
        createdAt: String(r.created_at || r.createdAt || ""),
        updatedAt: String(r.updated_at || r.updatedAt || ""),
        source: (r.source || "reflection") as LongTermFact["source"],
      }));

      store.preferences = raw.preferences.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        text: r.text as string,
        tags: (r.tags || []) as string[],
        weight: r.weight as number,
        frequency: r.frequency as number,
        examples: (r.examples || []) as string[],
        createdAt: String(r.created_at || r.createdAt || ""),
        updatedAt: String(r.updated_at || r.updatedAt || ""),
      }));

      store.signals = raw.signals.map((r: Record<string, unknown>) => ({
        id: r.id as string,
        type: r.type as SignalType,
        context: r.context as string,
        value: r.value as string,
        timestamp: String(r.timestamp || ""),
      }));

      store.snoozeRecords = raw.snoozeRecords.map((r: Record<string, unknown>) => ({
        taskTitle: (r.task_title || r.taskTitle) as string,
        taskCategory: (r.task_category || r.taskCategory) as string,
        snoozeCount: (r.snooze_count || r.snoozeCount) as number,
        originalDate: (r.original_date || r.originalDate) as string,
        lastSnoozed: String(r.last_snoozed || r.lastSnoozed || ""),
      }));

      store.taskTimings = raw.taskTimings.map((r: Record<string, unknown>) => ({
        taskCategory: (r.task_category || r.taskCategory) as string,
        taskKeywords: (r.task_keywords || r.taskKeywords || []) as string[],
        estimatedMinutes: (r.estimated_minutes || r.estimatedMinutes) as number,
        actualMinutes: (r.actual_minutes || r.actualMinutes) as number,
        date: r.date as string,
      }));

      store.lastReflectionAt = raw.lastReflectionAt;
      store.reflectionCount = raw.reflectionCount;

      this.store = store;
      this.rebuildIndices();
      this._dbReady = true;
      console.log("[Memory] Loaded from database");
    } catch (err) {
      console.warn("[Memory] DB load failed, using JSON fallback:", err);
    }
  }

  private loadFromDisk(): MemoryStore {
    try {
      if (fs.existsSync(this.savePath)) {
        const data = JSON.parse(fs.readFileSync(this.savePath, "utf-8"));
        return { ...createEmptyStore(), ...data };
      }
    } catch (err) {
      console.error("Failed to load memory:", err);
    }
    return createEmptyStore();
  }

  save(): void {
    if (!this.dirty) return;
    // JSON fallback save (keep for resilience)
    try {
      fs.mkdirSync(path.dirname(this.savePath), { recursive: true });
      fs.writeFileSync(this.savePath, JSON.stringify(this.store, null, 2), "utf-8");
      this.dirty = false;
    } catch (err) {
      console.error("Failed to save memory:", err);
    }
  }

  /** Force save regardless of dirty flag */
  forceSave(): void {
    this.dirty = true;
    this.save();
  }

  getStore(): MemoryStore {
    return this.store;
  }

  // ── Index Management ──────────────────────────────────

  private rebuildIndices(): void {
    this.factIndex.clear();
    this.prefTagIndex.clear();
    this.snoozeIndex.clear();
    this.signalsByType.clear();
    this.signalsByHour.clear();

    // Facts: O(n) build, O(1) lookup
    for (let i = 0; i < this.store.facts.length; i++) {
      const f = this.store.facts[i];
      this.factIndex.set(`${f.category}:${f.key}`, i);
    }

    // Preferences: inverted tag index — O(n·k) build, O(k) query
    for (let i = 0; i < this.store.preferences.length; i++) {
      for (const tag of this.store.preferences[i].tags) {
        const lowerTag = tag.toLowerCase();
        if (!this.prefTagIndex.has(lowerTag)) {
          this.prefTagIndex.set(lowerTag, new Set());
        }
        this.prefTagIndex.get(lowerTag)!.add(i);
      }
    }

    // Snooze records: composite key index
    for (let i = 0; i < this.store.snoozeRecords.length; i++) {
      const s = this.store.snoozeRecords[i];
      this.snoozeIndex.set(`${s.taskTitle}:${s.originalDate}`, i);
    }

    // Signals: type-bucketed + hour aggregation
    for (let i = 0; i < this.store.signals.length; i++) {
      const s = this.store.signals[i];
      if (!this.signalsByType.has(s.type)) {
        this.signalsByType.set(s.type, []);
      }
      this.signalsByType.get(s.type)!.push(i);

      // Aggregate hourly stats for dead-zone detection
      const hour = new Date(s.timestamp).getHours();
      if (!this.signalsByHour.has(hour)) {
        this.signalsByHour.set(hour, { completed: 0, skipped: 0 });
      }
      const stats = this.signalsByHour.get(hour)!;
      if (s.type === "task_completed" || s.type === "task_completed_early") {
        stats.completed++;
      } else if (s.type === "task_skipped" || s.type === "task_snoozed") {
        stats.skipped++;
      }
    }
  }

  // ── Layer 2: Long-Term Fact Management ────────────────
  // O(1) lookup + O(1) amortized insert via factIndex

  upsertFact(
    category: FactCategory,
    key: string,
    value: string,
    evidence: string,
    source: LongTermFact["source"] = "reflection"
  ): void {
    const indexKey = `${category}:${key}`;
    const existingIdx = this.factIndex.get(indexKey);

    if (existingIdx !== undefined) {
      const existing = this.store.facts[existingIdx];
      existing.value = value;
      existing.confidence = Math.min(1, existing.confidence + 0.15);
      if (!existing.evidence.includes(evidence)) {
        existing.evidence.push(evidence);
        if (existing.evidence.length > 10) {
          existing.evidence = existing.evidence.slice(-10);
        }
      }
      existing.updatedAt = new Date().toISOString();
    } else {
      const newFact: LongTermFact = {
        id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        category,
        key,
        value,
        confidence: 0.3,
        evidence: [evidence],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source,
      };
      const idx = this.store.facts.length;
      this.store.facts.push(newFact);
      this.factIndex.set(indexKey, idx);
    }
    this.dirty = true;

    // Write-through to DB (fire-and-forget)
    const fact = existingIdx !== undefined
      ? this.store.facts[existingIdx]
      : this.store.facts[this.store.facts.length - 1];
    dbUpsertFact(
      fact.id, fact.category, fact.key, fact.value,
      fact.confidence, fact.evidence, fact.source
    ).catch((e) => console.warn("[DB] fact write-through failed:", e));
  }

  getFactsByCategory(category: FactCategory): LongTermFact[] {
    return this.store.facts
      .filter((f) => f.category === category && f.confidence >= 0.2)
      .sort((a, b) => b.confidence - a.confidence);
  }

  getAllHighConfidenceFacts(): LongTermFact[] {
    return this.store.facts
      .filter((f) => f.confidence >= 0.4)
      .sort((a, b) => b.confidence - a.confidence);
  }

  // ── Layer 3: Semantic Preference Management ───────────
  // Uses inverted tag index for O(k) query instead of O(n·k)

  upsertPreference(
    text: string,
    tags: string[],
    weight: number,
    example: string
  ): void {
    // Find similar preference by tag overlap using the inverted index
    const candidateScores = new Map<number, number>();
    for (const tag of tags) {
      const lowerTag = tag.toLowerCase();
      const indices = this.prefTagIndex.get(lowerTag);
      if (indices) {
        for (const idx of indices) {
          candidateScores.set(idx, (candidateScores.get(idx) || 0) + 1);
        }
      }
    }

    // Find best match with ≥ min(2, tags.length) overlapping tags
    const threshold = Math.min(2, tags.length);
    let bestIdx = -1;
    let bestScore = 0;
    for (const [idx, score] of candidateScores) {
      if (score >= threshold && score > bestScore) {
        bestIdx = idx;
        bestScore = score;
      }
    }

    if (bestIdx >= 0) {
      const existing = this.store.preferences[bestIdx];
      existing.weight = existing.weight * 0.7 + weight * 0.3;
      existing.frequency += 1;
      if (!existing.examples.includes(example)) {
        existing.examples.push(example);
        if (existing.examples.length > 8) {
          existing.examples = existing.examples.slice(-8);
        }
      }
      // Merge tags + update index
      for (const tag of tags) {
        const lowerTag = tag.toLowerCase();
        if (!existing.tags.includes(tag)) {
          existing.tags.push(tag);
          if (!this.prefTagIndex.has(lowerTag)) {
            this.prefTagIndex.set(lowerTag, new Set());
          }
          this.prefTagIndex.get(lowerTag)!.add(bestIdx);
        }
      }
      existing.updatedAt = new Date().toISOString();
      // DB write-through for existing preference (with embedding)
      dbUpsertPreferenceWithEmbedding(
        existing.id, existing.text, existing.tags,
        existing.weight, existing.frequency, existing.examples
      ).catch((e) => console.warn("[DB] pref write-through failed:", e));
    } else {
      const idx = this.store.preferences.length;
      this.store.preferences.push({
        id: `pref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        tags,
        weight,
        frequency: 1,
        examples: [example],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      // Update inverted index
      for (const tag of tags) {
        const lowerTag = tag.toLowerCase();
        if (!this.prefTagIndex.has(lowerTag)) {
          this.prefTagIndex.set(lowerTag, new Set());
        }
        this.prefTagIndex.get(lowerTag)!.add(idx);
      }
      // DB write-through for new preference (with embedding)
      const newPref = this.store.preferences[idx];
      dbUpsertPreferenceWithEmbedding(
        newPref.id, newPref.text, newPref.tags,
        newPref.weight, newPref.frequency, newPref.examples
      ).catch((e) => console.warn("[DB] pref write-through failed:", e));
    }
    this.dirty = true;
  }

  /**
   * Query preferences by relevance to a context.
   * Uses inverted tag index: O(k · avgBucketSize) instead of O(n · k).
   */
  queryPreferences(contextTags: string[], limit = 10): SemanticPreference[] {
    if (contextTags.length === 0) return this.store.preferences.slice(0, limit);

    // Gather candidate preferences from inverted index
    const candidateScores = new Map<number, number>();
    for (const ct of contextTags) {
      const lowerCt = ct.toLowerCase();
      // Check exact match
      const exactHits = this.prefTagIndex.get(lowerCt);
      if (exactHits) {
        for (const idx of exactHits) {
          candidateScores.set(idx, (candidateScores.get(idx) || 0) + 1);
        }
      }
      // Check substring matches (only for tags we haven't exact-matched)
      for (const [tag, indices] of this.prefTagIndex) {
        if (tag === lowerCt) continue;
        if (tag.includes(lowerCt) || lowerCt.includes(tag)) {
          for (const idx of indices) {
            candidateScores.set(idx, (candidateScores.get(idx) || 0) + 0.5);
          }
        }
      }
    }

    // Score only the candidates, not all preferences
    const scored: Array<{ pref: SemanticPreference; relevance: number }> = [];
    for (const [idx, tagOverlap] of candidateScores) {
      const p = this.store.preferences[idx];
      const relevance =
        (tagOverlap / Math.max(1, contextTags.length)) *
        Math.abs(p.weight) *
        Math.log2(p.frequency + 1);
      if (relevance > 0) {
        scored.push({ pref: p, relevance });
      }
    }

    return scored
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit)
      .map((s) => s.pref);
  }

  /**
   * Query preferences using pgvector cosine similarity (DB-backed).
   * Falls back to in-memory tag matching if pgvector is unavailable.
   */
  async queryPreferencesSemantic(
    contextTags: string[],
    contextText: string,
    limit = 10
  ): Promise<SemanticPreference[]> {
    if (!this._dbReady) {
      return this.queryPreferences(contextTags, limit);
    }

    try {
      const results = await searchSimilarPreferences(contextTags, contextText, limit);
      if (results.length === 0) {
        return this.queryPreferences(contextTags, limit);
      }

      // Map DB results back to SemanticPreference shape
      return results.map((r) => {
        // Try to find in-memory version for full data
        const inMemory = this.store.preferences.find((p) => p.id === r.id);
        if (inMemory) return inMemory;
        return {
          id: r.id,
          text: r.text,
          tags: r.tags,
          weight: r.weight,
          frequency: r.frequency,
          examples: [],
          createdAt: "",
          updatedAt: "",
        };
      });
    } catch {
      return this.queryPreferences(contextTags, limit);
    }
  }

  // ── Behavioral Signal Recording ───────────────────────
  // O(1) append with index maintenance

  recordSignal(type: SignalType, context: string, value: string): void {
    const signal: BehavioralSignal = {
      id: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      context,
      value,
      timestamp: new Date().toISOString(),
    };

    const idx = this.store.signals.length;
    this.store.signals.push(signal);

    // DB write-through
    dbInsertSignal(signal.id, signal.type, signal.context, signal.value)
      .catch((e) => console.warn("[DB] signal write-through failed:", e));

    // Maintain type index
    if (!this.signalsByType.has(type)) {
      this.signalsByType.set(type, []);
    }
    this.signalsByType.get(type)!.push(idx);

    // Maintain hourly aggregation
    const hour = new Date().getHours();
    if (!this.signalsByHour.has(hour)) {
      this.signalsByHour.set(hour, { completed: 0, skipped: 0 });
    }
    const stats = this.signalsByHour.get(hour)!;
    if (type === "task_completed" || type === "task_completed_early") {
      stats.completed++;
    } else if (type === "task_skipped" || type === "task_snoozed") {
      stats.skipped++;
    }

    // Cap at 500 (rolling window) — rebuild indices when trimming
    if (this.store.signals.length > 500) {
      this.store.signals = this.store.signals.slice(-500);
      this.rebuildSignalIndices();
    }

    this.dirty = true;
  }

  /** Rebuild only signal-related indices (cheaper than full rebuild) */
  private rebuildSignalIndices(): void {
    this.signalsByType.clear();
    this.signalsByHour.clear();
    for (let i = 0; i < this.store.signals.length; i++) {
      const s = this.store.signals[i];
      if (!this.signalsByType.has(s.type)) {
        this.signalsByType.set(s.type, []);
      }
      this.signalsByType.get(s.type)!.push(i);

      const hour = new Date(s.timestamp).getHours();
      if (!this.signalsByHour.has(hour)) {
        this.signalsByHour.set(hour, { completed: 0, skipped: 0 });
      }
      const stats = this.signalsByHour.get(hour)!;
      if (s.type === "task_completed" || s.type === "task_completed_early") {
        stats.completed++;
      } else if (s.type === "task_skipped" || s.type === "task_snoozed") {
        stats.skipped++;
      }
    }
  }

  recordSnooze(taskTitle: string, taskCategory: string, originalDate: string): void {
    const key = `${taskTitle}:${originalDate}`;
    const existingIdx = this.snoozeIndex.get(key);

    if (existingIdx !== undefined) {
      const existing = this.store.snoozeRecords[existingIdx];
      existing.snoozeCount += 1;
      existing.lastSnoozed = new Date().toISOString();
    } else {
      const idx = this.store.snoozeRecords.length;
      this.store.snoozeRecords.push({
        taskTitle,
        taskCategory,
        snoozeCount: 1,
        originalDate,
        lastSnoozed: new Date().toISOString(),
      });
      this.snoozeIndex.set(key, idx);
    }

    // DB write-through
    dbUpsertSnooze(taskTitle, taskCategory, originalDate)
      .catch((e) => console.warn("[DB] snooze write-through failed:", e));

    // Cap at 100
    if (this.store.snoozeRecords.length > 100) {
      this.store.snoozeRecords = this.store.snoozeRecords.slice(-100);
      // Rebuild snooze index
      this.snoozeIndex.clear();
      for (let i = 0; i < this.store.snoozeRecords.length; i++) {
        const s = this.store.snoozeRecords[i];
        this.snoozeIndex.set(`${s.taskTitle}:${s.originalDate}`, i);
      }
    }

    this.dirty = true;
  }

  recordTaskTiming(
    taskCategory: string,
    taskKeywords: string[],
    estimatedMinutes: number,
    actualMinutes: number
  ): void {
    this.store.taskTimings.push({
      taskCategory,
      taskKeywords,
      estimatedMinutes,
      actualMinutes,
      date: new Date().toISOString().split("T")[0],
    });

    // DB write-through
    dbInsertTaskTiming(
      taskCategory, taskKeywords, estimatedMinutes, actualMinutes,
      new Date().toISOString().split("T")[0]
    ).catch((e) => console.warn("[DB] timing write-through failed:", e));

    if (this.store.taskTimings.length > 200) {
      this.store.taskTimings = this.store.taskTimings.slice(-200);
    }

    this.dirty = true;
  }

  // ── Index-backed Query Helpers ────────────────────────

  /** O(1) lookup for hourly completion/skip stats */
  getHourlyStats(hour: number): { completed: number; skipped: number } {
    return this.signalsByHour.get(hour) ?? { completed: 0, skipped: 0 };
  }

  /** O(1) type-filtered signals (returns indices, dereference as needed) */
  getSignalsByType(type: SignalType): BehavioralSignal[] {
    const indices = this.signalsByType.get(type) ?? [];
    return indices.map((i) => this.store.signals[i]);
  }

  /** Get signals filtered by date threshold — uses type index + date filter */
  getRecentSignalsByType(type: SignalType, sinceDate: string): BehavioralSignal[] {
    const indices = this.signalsByType.get(type) ?? [];
    // Signals are appended chronologically so we can binary-search for the cutoff
    // but for ≤500 items a simple reverse scan is fast enough
    const result: BehavioralSignal[] = [];
    for (let i = indices.length - 1; i >= 0; i--) {
      const s = this.store.signals[indices[i]];
      if (s.timestamp <= sinceDate) break;
      result.push(s);
    }
    return result.reverse();
  }

  /** Get chronic snooze records (snoozed ≥ threshold times) */
  getChronicSnoozes(threshold = 3): SnoozeRecord[] {
    return this.store.snoozeRecords.filter((s) => s.snoozeCount >= threshold);
  }

  // ── Memory Meta ───────────────────────────────────────

  updateReflectionMeta(): void {
    this.store.lastReflectionAt = new Date().toISOString();
    this.store.reflectionCount += 1;
    this.dirty = true;

    // DB write-through
    dbUpdateReflectionMeta(this.store.lastReflectionAt, this.store.reflectionCount)
      .catch((e) => console.warn("[DB] reflection meta write-through failed:", e));
  }

  getLastReflectionAt(): string | null {
    return this.store.lastReflectionAt;
  }

  getReflectionCount(): number {
    return this.store.reflectionCount;
  }
}

// ── Singleton & backward-compat free functions ──────────
// Maintain the same public API so existing callers don't break,
// but route everything through the singleton MemoryManager.

let _manager: MemoryManager | null = null;
let _managerReady: Promise<void> | null = null;

export function getManager(): MemoryManager {
  if (!_manager) {
    _manager = new MemoryManager();
    // Kick off DB load (async, will replace JSON data when ready)
    _managerReady = _manager.loadFromDB();
  }
  return _manager;
}

/** Wait for the manager to finish loading from DB */
export async function ensureManagerReady(): Promise<MemoryManager> {
  const mgr = getManager();
  if (_managerReady) await _managerReady;
  return mgr;
}

// ── Storage ─────────────────────────────────────────────

const MEMORY_FILE = "northstar-memory.json";

function getMemoryPath(): string {
  const userDataPath = app.getPath("userData");
  return path.join(userDataPath, MEMORY_FILE);
}

function createEmptyStore(): MemoryStore {
  return {
    facts: [],
    preferences: [],
    signals: [],
    snoozeRecords: [],
    taskTimings: [],
    lastReflectionAt: null,
    reflectionCount: 0,
    version: 1,
  };
}

export function loadMemory(): MemoryStore {
  return getManager().getStore();
}

export function saveMemory(memory: MemoryStore): void {
  // For backward compat (e.g. memory:clear resets the store)
  // Write to both JSON fallback and trigger manager reload
  try {
    const filePath = getMemoryPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(memory, null, 2), "utf-8");
    // Force manager reload from JSON, then it'll sync to DB
    _manager = new MemoryManager();
    _managerReady = _manager.loadFromDB();
  } catch (err) {
    console.error("Failed to save memory:", err);
  }
}

// ── Backward-compatible free functions ──────────────────
// These delegate to the singleton MemoryManager.

export function upsertFact(
  memory: MemoryStore,
  category: FactCategory,
  key: string,
  value: string,
  evidence: string,
  source: LongTermFact["source"] = "reflection"
): MemoryStore {
  const mgr = getManager();
  mgr.upsertFact(category, key, value, evidence, source);
  return mgr.getStore();
}

export function getFactsByCategory(
  memory: MemoryStore,
  category: FactCategory
): LongTermFact[] {
  return getManager().getFactsByCategory(category);
}

export function getAllHighConfidenceFacts(memory: MemoryStore): LongTermFact[] {
  return getManager().getAllHighConfidenceFacts();
}

export function upsertPreference(
  memory: MemoryStore,
  text: string,
  tags: string[],
  weight: number,
  example: string
): MemoryStore {
  const mgr = getManager();
  mgr.upsertPreference(text, tags, weight, example);
  return mgr.getStore();
}

export function queryPreferences(
  memory: MemoryStore,
  contextTags: string[],
  limit = 10
): SemanticPreference[] {
  return getManager().queryPreferences(contextTags, limit);
}

export function recordSignal(
  memory: MemoryStore,
  type: SignalType,
  context: string,
  value: string
): MemoryStore {
  const mgr = getManager();
  mgr.recordSignal(type, context, value);
  return mgr.getStore();
}

export function recordSnooze(
  memory: MemoryStore,
  taskTitle: string,
  taskCategory: string,
  originalDate: string
): MemoryStore {
  const mgr = getManager();
  mgr.recordSnooze(taskTitle, taskCategory, originalDate);
  return mgr.getStore();
}

export function recordTaskTiming(
  memory: MemoryStore,
  taskCategory: string,
  taskKeywords: string[],
  estimatedMinutes: number,
  actualMinutes: number
): MemoryStore {
  const mgr = getManager();
  mgr.recordTaskTiming(taskCategory, taskKeywords, estimatedMinutes, actualMinutes);
  return mgr.getStore();
}

// ── Capacity Score Calculator ───────────────────────────

/**
 * Compute a data-driven "capacity profile" for the user based on
 * their behavioral history. This gets injected into the daily task
 * generation prompt so the AI can calibrate task count + weight.
 *
 * Returns a structured object with:
 * - capacityBudget: max cognitive weight points (6-12 scale)
 * - recentCompletionRate: % of tasks completed in last 14 days
 * - avgTasksCompletedPerDay: actual throughput
 * - avgTasksAssignedPerDay: how many were assigned
 * - dayOfWeekModifier: adjustment for today's day-of-week pattern
 * - overwhemDays: count of recent days with 3+ skips
 * - trend: "improving" | "declining" | "stable"
 */
export interface CapacityProfile {
  capacityBudget: number;
  recentCompletionRate: number;
  avgTasksCompletedPerDay: number;
  avgTasksAssignedPerDay: number;
  dayOfWeekModifier: number;       // -2 to +2
  overwhelmDays: number;
  trend: "improving" | "declining" | "stable";
  isNewUser: boolean;
  chronicSnoozePatterns: string[];  // task types/keywords that are frequently snoozed
  monthlyContextApplied?: boolean;  // true when monthly context modified the budget
  maxDailyTasks?: number;           // override from monthly context
}

export function computeCapacityProfile(
  memory: MemoryStore,
  dailyLogs: Array<{ date: string; tasks: Array<{ completed: boolean; skipped?: boolean }> }>,
  todayDayOfWeek: number,
  monthlyContext?: { capacityMultiplier: number; maxDailyTasks: number } | null
): CapacityProfile {
  const DEFAULT_BUDGET = 10;

  // No history → new user defaults
  if (!dailyLogs || dailyLogs.length === 0) {
    return {
      capacityBudget: DEFAULT_BUDGET,
      recentCompletionRate: -1, // -1 means "no data"
      avgTasksCompletedPerDay: 0,
      avgTasksAssignedPerDay: 0,
      dayOfWeekModifier: 0,
      overwhelmDays: 0,
      trend: "stable",
      isNewUser: true,
      chronicSnoozePatterns: [],
    };
  }

  // Use last 14 days of logs
  const recentLogs = dailyLogs
    .filter((l) => {
      const diff = Date.now() - new Date(l.date).getTime();
      return diff <= 14 * 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recentLogs.length === 0) {
    return {
      capacityBudget: DEFAULT_BUDGET,
      recentCompletionRate: -1,
      avgTasksCompletedPerDay: 0,
      avgTasksAssignedPerDay: 0,
      dayOfWeekModifier: 0,
      overwhelmDays: 0,
      trend: "stable",
      isNewUser: true,
      chronicSnoozePatterns: [],
    };
  }

  // Compute per-day stats
  let totalAssigned = 0;
  let totalCompleted = 0;
  let overwhelmDays = 0;

  for (const log of recentLogs) {
    const assigned = log.tasks.length;
    const completed = log.tasks.filter((t) => t.completed).length;
    const skipped = log.tasks.filter((t) => t.skipped || (!t.completed)).length;
    totalAssigned += assigned;
    totalCompleted += completed;
    if (skipped >= 3) overwhelmDays++;
  }

  const recentCompletionRate = totalAssigned > 0
    ? Math.round((totalCompleted / totalAssigned) * 100)
    : -1;
  const avgAssigned = totalAssigned / recentLogs.length;
  const avgCompleted = totalCompleted / recentLogs.length;

  // Trend: compare first half vs second half of recent logs
  let trend: "improving" | "declining" | "stable" = "stable";
  if (recentLogs.length >= 4) {
    const mid = Math.floor(recentLogs.length / 2);
    const firstHalf = recentLogs.slice(0, mid);
    const secondHalf = recentLogs.slice(mid);
    const firstRate = firstHalf.reduce((sum, l) => {
      const c = l.tasks.filter((t) => t.completed).length;
      return sum + (l.tasks.length > 0 ? c / l.tasks.length : 0);
    }, 0) / firstHalf.length;
    const secondRate = secondHalf.reduce((sum, l) => {
      const c = l.tasks.filter((t) => t.completed).length;
      return sum + (l.tasks.length > 0 ? c / l.tasks.length : 0);
    }, 0) / secondHalf.length;
    if (secondRate - firstRate > 0.1) trend = "improving";
    else if (firstRate - secondRate > 0.1) trend = "declining";
  }

  // Day-of-week modifier from signals
  const mgr = getManager();
  const signals = mgr.getStore().signals;
  let dayCompleted = 0;
  let dayTotal = 0;
  for (const s of signals) {
    if (!["task_completed", "task_completed_early", "task_skipped", "task_snoozed"].includes(s.type)) continue;
    const d = new Date(s.timestamp).getDay();
    if (d !== todayDayOfWeek) continue;
    dayTotal++;
    if (s.type === "task_completed" || s.type === "task_completed_early") {
      dayCompleted++;
    }
  }
  let dayOfWeekModifier = 0;
  if (dayTotal >= 5) {
    const dayRate = dayCompleted / dayTotal;
    if (dayRate >= 0.85) dayOfWeekModifier = 1;       // strong day → bonus
    else if (dayRate <= 0.4) dayOfWeekModifier = -2;   // weak day → reduce
    else if (dayRate <= 0.55) dayOfWeekModifier = -1;  // below average → slight reduce
  }

  // Calculate capacity budget (6-12 range)
  let budget = DEFAULT_BUDGET; // 10

  // Adjust based on completion rate
  if (recentCompletionRate >= 0) {
    if (recentCompletionRate < 40) budget = 6;
    else if (recentCompletionRate < 60) budget = 8;
    else if (recentCompletionRate < 75) budget = 9;
    else if (recentCompletionRate < 85) budget = 10;
    else if (recentCompletionRate < 95) budget = 11;
    else budget = 12;
  }

  // Adjust for overwhelm
  if (overwhelmDays >= 3) budget = Math.max(6, budget - 2);
  else if (overwhelmDays >= 1) budget = Math.max(6, budget - 1);

  // Adjust for trend
  if (trend === "declining") budget = Math.max(6, budget - 1);
  else if (trend === "improving" && budget < 12) budget = Math.min(12, budget + 1);

  // Day-of-week adjustment
  budget = Math.max(6, Math.min(12, budget + dayOfWeekModifier));

  // Detect chronic snooze patterns from behavioral signals
  const chronicSnoozePatterns: string[] = [];
  const snoozeCounts = new Map<string, number>();
  for (const s of signals) {
    if (s.type !== "task_snoozed") continue;
    const diff = Date.now() - new Date(s.timestamp).getTime();
    if (diff > 14 * 24 * 60 * 60 * 1000) continue; // last 14 days only
    // Extract task info from signal context/value
    const key = s.context || s.value || "unknown";
    snoozeCounts.set(key, (snoozeCounts.get(key) || 0) + 1);
  }
  for (const [key, count] of snoozeCounts) {
    if (count >= 3) chronicSnoozePatterns.push(key); // snoozed 3+ times in 14 days
  }

  // Apply monthly context multiplier (e.g., exam season → 0.3x, vacation → 1.5x)
  let monthlyContextApplied = false;
  let maxDailyTasks: number | undefined;
  if (monthlyContext) {
    budget = Math.max(4, Math.min(12, Math.round(budget * monthlyContext.capacityMultiplier)));
    maxDailyTasks = monthlyContext.maxDailyTasks;
    monthlyContextApplied = true;
  }

  return {
    capacityBudget: budget,
    recentCompletionRate,
    avgTasksCompletedPerDay: Math.round(avgCompleted * 10) / 10,
    avgTasksAssignedPerDay: Math.round(avgAssigned * 10) / 10,
    dayOfWeekModifier,
    overwhelmDays,
    trend,
    isNewUser: false,
    chronicSnoozePatterns,
    monthlyContextApplied,
    maxDailyTasks,
  };
}

// ── Memory-to-Prompt Builder ────────────────────────────

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Build a dynamic memory context block to inject into AI system prompts.
 * Uses indexed lookups from MemoryManager for efficient data retrieval.
 *
 * The output follows a "micro-adjustment injection" pattern:
 *   1. Current User Preferences (stable, high-confidence facts)
 *   2. Feedback Updates (timestamped recent learnings — the changelog)
 *   3. Behavioral Patterns (day-of-week + hour-of-day analysis)
 *   4. Active Constraints (snooze alerts, timing calibrations)
 *   5. Context-specific directive (what the AI should do with this info)
 */
export function buildMemoryContext(
  memory: MemoryStore,
  contextType: "planning" | "daily" | "recovery" | "general",
  contextTags: string[] = []
): string {
  const mgr = getManager();
  const lines: string[] = [];
  const today = new Date().toISOString().split("T")[0];

  // ═══════════════════════════════════════════════════════
  // Section 1: CURRENT USER PREFERENCES
  // O(n) filter on facts — n is small (typically < 50)
  // ═══════════════════════════════════════════════════════
  const facts = mgr.getAllHighConfidenceFacts();
  if (facts.length > 0) {
    lines.push("Current User Preferences retrieved from memory:");
    lines.push("");

    // Group facts by category — single pass O(n)
    const grouped = new Map<string, LongTermFact[]>();
    for (const f of facts.slice(0, 20)) {
      const arr = grouped.get(f.category);
      if (arr) arr.push(f);
      else grouped.set(f.category, [f]);
    }

    // Priority order for context type
    const categoryOrder: Record<string, string[]> = {
      daily: ["schedule", "preference", "pattern", "capacity", "constraint", "motivation", "strength", "struggle"],
      planning: ["capacity", "schedule", "constraint", "preference", "pattern", "motivation", "strength", "struggle"],
      recovery: ["struggle", "motivation", "pattern", "constraint", "strength", "preference", "capacity", "schedule"],
      general: ["preference", "schedule", "pattern", "capacity", "motivation", "constraint", "strength", "struggle"],
    };
    const order = categoryOrder[contextType] || categoryOrder.general;

    for (const cat of order) {
      const catFacts = grouped.get(cat);
      if (!catFacts || catFacts.length === 0) continue;
      for (const f of catFacts) {
        const conf = f.confidence >= 0.8 ? "🟢" : f.confidence >= 0.5 ? "🟡" : "⚪";
        lines.push(`  ${conf} ${f.value}`);
      }
    }
    lines.push("");
  }

  // ═══════════════════════════════════════════════════════
  // Section 2: FEEDBACK UPDATES (timestamped micro-adjustments)
  // ═══════════════════════════════════════════════════════
  const recentUpdates = buildFeedbackTimeline(mgr, contextType);
  if (recentUpdates.length > 0) {
    for (const update of recentUpdates) {
      lines.push(update);
    }
    lines.push("");
  }

  // ═══════════════════════════════════════════════════════
  // Section 3: BEHAVIORAL PATTERNS
  // Uses pre-aggregated hourly stats from MemoryManager
  // ═══════════════════════════════════════════════════════
  const patterns = buildBehavioralInsights(mgr);
  const dayPatterns = buildDayOfWeekInsights(mgr);
  const allPatterns = [...patterns, ...dayPatterns];

  if (allPatterns.length > 0) {
    lines.push("Behavioral Patterns (observed over time):");
    lines.push("");
    for (const p of allPatterns) {
      lines.push(`  • ${p}`);
    }
    lines.push("");
  }

  // ═══════════════════════════════════════════════════════
  // Section 4: ACTIVE CONSTRAINTS
  // ═══════════════════════════════════════════════════════

  // Chronic snoozes — O(s) where s = snooze records, typically < 100
  const chronicSnoozes = mgr.getChronicSnoozes(3);
  if (chronicSnoozes.length > 0 && (contextType === "daily" || contextType === "recovery")) {
    lines.push("⚠️ Chronically Snoozed Tasks (user keeps pushing these — consider restructuring):");
    lines.push("");
    for (const s of chronicSnoozes.slice(0, 5)) {
      lines.push(`  "${s.taskTitle}" — snoozed ${s.snoozeCount}x (category: ${s.taskCategory})`);
    }
    lines.push("  → Consider: Is timing wrong? Is the task too big? Should it be broken down or rescheduled?");
    lines.push("");
  }

  // Duration calibration
  const timingInsights = buildTimingInsights(memory);
  if (timingInsights.length > 0 && (contextType === "planning" || contextType === "daily")) {
    lines.push("Duration Calibration (actual vs estimated from past tasks):");
    lines.push("");
    for (const t of timingInsights) {
      lines.push(`  ${t}`);
    }
    lines.push("");
  }

  // Relevant semantic preferences — uses inverted tag index O(k)
  const relevantTags = [
    ...contextTags,
    contextType,
    ...(contextType === "daily" ? ["morning", "evening", "energy", "timing", "duration", "focus", "deep_work"] : []),
    ...(contextType === "recovery" ? ["blocker", "motivation", "struggle", "energy", "overwhelm", "burnout"] : []),
    ...(contextType === "planning" ? ["schedule", "capacity", "preference", "intensity", "pace", "deadline"] : []),
  ];
  const prefs = mgr.queryPreferences(relevantTags, 8);
  if (prefs.length > 0) {
    lines.push("Learned Preferences (softer patterns from behavior):");
    lines.push("");
    for (const p of prefs) {
      const sentiment = p.weight > 0.3 ? "👍" : p.weight < -0.3 ? "👎" : "↔️";
      lines.push(`  ${sentiment} ${p.text} (observed ${p.frequency}x)`);
    }
    lines.push("");
  }

  // ═══════════════════════════════════════════════════════
  // Section 5: CONTEXT-SPECIFIC DIRECTIVE
  // Tell the AI exactly how to use this information
  // ═══════════════════════════════════════════════════════
  const directive = getContextDirective(contextType, today);
  lines.push(directive);

  if (lines.length <= 1) {
    return ""; // Only directive, no real memory — fresh user
  }

  return [
    "═══ PERSONALIZATION MEMORY (Micro-Adjustments from Reflection Loop) ═══",
    "",
    ...lines,
    "═══ END MEMORY ═══",
    "",
  ].join("\n");
}

// ── Feedback Timeline Builder ───────────────────────────

/**
 * Build a timestamped timeline of recent micro-adjustments.
 * Uses MemoryManager for indexed signal access.
 */
function buildFeedbackTimeline(
  mgr: MemoryManager,
  contextType: string,
  maxEntries = 12
): string[] {
  const store = mgr.getStore();
  const entries: Array<{ date: string; text: string; priority: number }> = [];

  // 1. Recent facts that were updated
  const recentFacts = store.facts
    .filter((f) => f.confidence >= 0.3)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 15);

  for (const f of recentFacts) {
    const date = f.updatedAt.split("T")[0];
    const isRecent = isWithinDays(f.updatedAt, 14);
    if (!isRecent && entries.length >= 6) continue;

    let priority = f.confidence;
    if (isRecent) priority += 0.5;
    if (contextType === "daily" && ["schedule", "pattern", "preference"].includes(f.category)) priority += 0.3;
    if (contextType === "recovery" && ["struggle", "motivation", "constraint"].includes(f.category)) priority += 0.3;
    if (contextType === "planning" && ["capacity", "schedule", "constraint"].includes(f.category)) priority += 0.3;

    entries.push({
      date,
      text: `Feedback Update (${date}): ${f.value}`,
      priority,
    });
  }

  // 2. Recent explicit feedback signals — O(1) type lookup via index
  const feedbackSignals = [
    ...mgr.getSignalsByType("positive_feedback"),
    ...mgr.getSignalsByType("negative_feedback"),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 8);

  for (const s of feedbackSignals) {
    const date = s.timestamp.split("T")[0];
    const sentiment = s.type === "positive_feedback" ? "User liked" : "User disliked";
    entries.push({
      date,
      text: `Feedback Update (${date}): ${sentiment}: ${s.value} (context: ${s.context})`,
      priority: 1.5,
    });
  }

  // 3. Recent recovery events — O(1) type lookup
  const recoverySignals = [
    ...mgr.getSignalsByType("recovery_triggered"),
    ...mgr.getSignalsByType("blocker_reported"),
  ]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 5);

  for (const s of recoverySignals) {
    const date = s.timestamp.split("T")[0];
    if (s.type === "blocker_reported") {
      entries.push({
        date,
        text: `Feedback Update (${date}): User reported blocker — "${s.context}": ${s.value}`,
        priority: contextType === "recovery" ? 2.0 : 1.0,
      });
    }
  }

  // 4. Recent preference changes
  const recentPrefs = store.preferences
    .filter((p) => isWithinDays(p.updatedAt, 14) && p.frequency >= 2)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  for (const p of recentPrefs) {
    const date = p.updatedAt.split("T")[0];
    const direction = p.weight > 0.3 ? "prefers" : p.weight < -0.3 ? "avoids" : "is neutral on";
    const latestExample = p.examples[p.examples.length - 1];
    if (latestExample) {
      entries.push({
        date,
        text: `Feedback Update (${date}): User ${direction}: ${p.text}`,
        priority: 0.8 + Math.abs(p.weight),
      });
    }
  }

  // 5. Snooze patterns
  const recentSnoozes = store.snoozeRecords
    .filter((s) => isWithinDays(s.lastSnoozed, 7) && s.snoozeCount >= 2)
    .sort((a, b) => b.snoozeCount - a.snoozeCount)
    .slice(0, 3);

  for (const s of recentSnoozes) {
    const date = s.lastSnoozed.split("T")[0];
    entries.push({
      date,
      text: `Feedback Update (${date}): User has snoozed "${s.taskTitle}" ${s.snoozeCount}x — likely wrong timing or scope`,
      priority: 0.9 + s.snoozeCount * 0.1,
    });
  }

  // Sort by priority, deduplicate
  const sorted = entries
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxEntries);

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of sorted) {
    const key = entry.text.slice(0, 60).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry.text);
    }
  }

  return deduped;
}

// ── Day-of-Week Insights ────────────────────────────────

/**
 * Analyze signals by day of week to find patterns.
 * Uses type-indexed signal access from MemoryManager.
 */
function buildDayOfWeekInsights(mgr: MemoryManager): string[] {
  const insights: string[] = [];
  const store = mgr.getStore();
  const signals = store.signals;
  if (signals.length < 10) return insights;

  // Single-pass aggregation: count completions vs skips by day-of-week
  const completedByDay: Record<number, number> = {};
  const skippedByDay: Record<number, number> = {};
  const totalByDay: Record<number, number> = {};
  // Also track day+time combos and category performance
  const dayTimeSkips: Record<string, number> = {};
  const dayTimeTotals: Record<string, number> = {};
  const catByDay: Record<string, { completed: number; total: number }> = {};

  // Single pass over all relevant signals — O(n) where n ≤ 500
  for (const s of signals) {
    if (!["task_completed", "task_completed_early", "task_skipped", "task_snoozed"].includes(s.type)) continue;

    const dt = new Date(s.timestamp);
    const day = dt.getDay();
    const hour = dt.getHours();
    const timeSlot = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";

    totalByDay[day] = (totalByDay[day] || 0) + 1;

    const isCompletion = s.type === "task_completed" || s.type === "task_completed_early";
    if (isCompletion) {
      completedByDay[day] = (completedByDay[day] || 0) + 1;
    } else {
      skippedByDay[day] = (skippedByDay[day] || 0) + 1;
    }

    // Day+time combo tracking
    const dtKey = `${day}-${timeSlot}`;
    dayTimeTotals[dtKey] = (dayTimeTotals[dtKey] || 0) + 1;
    if (!isCompletion) {
      dayTimeSkips[dtKey] = (dayTimeSkips[dtKey] || 0) + 1;
    }

    // Category performance by day
    const catMatch = s.value.match(/category:\s*(\w+)/i);
    if (catMatch) {
      const catKey = `${catMatch[1]}-${DAY_NAMES[day]}`;
      if (!catByDay[catKey]) catByDay[catKey] = { completed: 0, total: 0 };
      catByDay[catKey].total += 1;
      if (isCompletion) catByDay[catKey].completed += 1;
    }
  }

  // Analyze day-of-week patterns
  for (let day = 0; day < 7; day++) {
    const total = totalByDay[day] || 0;
    if (total < 3) continue;
    const completed = completedByDay[day] || 0;
    const skipped = skippedByDay[day] || 0;
    const completionRate = completed / total;
    const skipRate = skipped / total;

    if (completionRate >= 0.8 && total >= 4) {
      insights.push(`${DAY_NAMES[day]}s are a strong productivity day (${Math.round(completionRate * 100)}% completion rate)`);
    } else if (skipRate >= 0.5 && total >= 4) {
      insights.push(`${DAY_NAMES[day]}s tend to be low-energy — user skips/snoozes ${Math.round(skipRate * 100)}% of tasks`);
    }
  }

  // Day+time combo insights
  for (const [key, total] of Object.entries(dayTimeTotals)) {
    if (total < 3) continue;
    const skips = dayTimeSkips[key] || 0;
    const skipRate = skips / total;
    if (skipRate >= 0.6) {
      const [dayStr, timeSlot] = key.split("-");
      const dayName = DAY_NAMES[parseInt(dayStr)];
      insights.push(
        `User tends to lack energy on ${dayName} ${timeSlot}s — ${Math.round(skipRate * 100)}% skip rate (${total} data points)`
      );
    }
  }

  // Category-by-day insights
  for (const [key, data] of Object.entries(catByDay)) {
    if (data.total < 3) continue;
    const rate = data.completed / data.total;
    const [cat, dayName] = key.split("-");
    if (rate >= 0.85) {
      insights.push(`User is more likely to complete "${cat}" tasks on ${dayName}s`);
    } else if (rate <= 0.3) {
      insights.push(`User rarely completes "${cat}" tasks on ${dayName}s — consider rescheduling`);
    }
  }

  return insights;
}

// ── Context Directive ───────────────────────────────────

/**
 * Generate a context-specific directive that tells the AI exactly
 * how to apply the memory data for this type of request.
 */
function getContextDirective(contextType: string, today: string): string {
  switch (contextType) {
    case "daily":
      return `Task: Plan today's schedule (${today}) keeping ALL of the above constraints in mind.
  - Respect the user's energy patterns by time-of-day and day-of-week
  - Apply duration calibrations — if tasks historically take longer, allocate more time
  - Avoid scheduling tasks at times/days where the user has high skip rates
  - If any Feedback Updates mention recent blockers, account for emotional recovery
  - If a task has been snoozed 3+ times, restructure it (break down, change timing, or flag it)`;

    case "planning":
      return `Task: Create a plan that respects ALL of the above learned constraints.
  - Use capacity insights to set realistic daily/weekly targets
  - Factor in day-of-week patterns when distributing work across the week
  - Apply duration calibrations to time estimates
  - Account for constraints and schedule preferences
  - If the user has shown patterns of overwhelm, build in more buffer`;

    case "recovery":
      return `Task: Help the user recover from missed tasks, keeping the above context in mind.
  - Look at the Feedback Updates to understand what's been going wrong
  - Reference their known strengths when reframing the situation
  - Avoid rescheduling to times/days where they historically struggle
  - If there's a pattern of the same blocker recurring, address the root cause
  - Be especially gentle if recent signals show multiple consecutive misses`;

    default:
      return `Task: Respond to the user keeping ALL of the above personalization in mind.
  - Reference their known preferences and patterns naturally
  - Apply any recent feedback updates to your recommendations`;
  }
}

// ── Utility ─────────────────────────────────────────────

function isWithinDays(dateStr: string, days: number): boolean {
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff <= days * 24 * 60 * 60 * 1000;
}

// ── Insight Builders ────────────────────────────────────

/**
 * Build behavioral insights using MemoryManager's pre-aggregated
 * hourly stats for O(24) peak-hour detection instead of O(n).
 */
function buildBehavioralInsights(mgr: MemoryManager): string[] {
  const insights: string[] = [];
  const store = mgr.getStore();
  const signals = store.signals;
  if (signals.length < 5) return insights;

  // Peak/worst hours — O(24) using pre-aggregated hourly stats
  const hourScores: Array<{ hour: number; score: number }> = [];
  for (let h = 0; h < 24; h++) {
    const stats = mgr.getHourlyStats(h);
    if (stats.completed > 0 || stats.skipped > 0) {
      hourScores.push({ hour: h, score: stats.completed - stats.skipped });
    }
  }

  const bestHours = hourScores
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (bestHours.length > 0) {
    const hourStrs = bestHours.map((h) => {
      const label = h.hour < 12 ? "AM" : "PM";
      const displayHour = h.hour === 0 ? 12 : h.hour > 12 ? h.hour - 12 : h.hour;
      return `${displayHour}${label}`;
    }).join(", ");
    insights.push(`User prefers deep work around: ${hourStrs}`);
  }

  const worstHours = hourScores
    .filter((h) => h.score < -1)
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
  if (worstHours.length > 0) {
    const hourStrs = worstHours.map((h) => {
      const label = h.hour < 12 ? "AM" : "PM";
      const displayHour = h.hour === 0 ? 12 : h.hour > 12 ? h.hour - 12 : h.hour;
      return `${displayHour}${label}`;
    }).join(", ");
    insights.push(`User tends to skip/snooze tasks around: ${hourStrs}`);
  }

  // Recovery frequency — O(1) type lookup
  const recoveries = mgr.getSignalsByType("recovery_triggered");
  if (recoveries.length >= 3) {
    const blockerCounts = new Map<string, number>();
    for (const r of recoveries) {
      blockerCounts.set(r.value, (blockerCounts.get(r.value) || 0) + 1);
    }
    let topBlocker: [string, number] | null = null;
    for (const entry of blockerCounts) {
      if (!topBlocker || entry[1] > topBlocker[1]) {
        topBlocker = entry;
      }
    }
    if (topBlocker) {
      insights.push(
        `Most common blocker: "${topBlocker[0]}" (${topBlocker[1]} occurrences)`
      );
    }
  }

  // Session time patterns — O(1) type lookup
  const sessions = mgr.getSignalsByType("session_time");
  if (sessions.length >= 5) {
    const hours = sessions.map((s) => new Date(s.timestamp).getHours());
    const avgHour = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
    const label = avgHour < 12 ? "AM" : "PM";
    const displayHour = avgHour === 0 ? 12 : avgHour > 12 ? avgHour - 12 : avgHour;
    insights.push(`Usually opens app around ${displayHour}${label}`);
  }

  // Recent completion rate — O(1) type lookups
  const recentCompleted = mgr.getSignalsByType("task_completed").slice(-30);
  const recentSkippedArr = [
    ...mgr.getSignalsByType("task_skipped"),
    ...mgr.getSignalsByType("task_snoozed"),
  ].slice(-30);
  if (recentCompleted.length + recentSkippedArr.length > 10) {
    const rate = Math.round(
      (recentCompleted.length /
        (recentCompleted.length + recentSkippedArr.length)) *
        100
    );
    if (rate >= 85) {
      insights.push(`Strong recent momentum: ${rate}% completion rate (last 30 signals)`);
    } else if (rate <= 40) {
      insights.push(`⚠️ Low completion rate recently: ${rate}% (last 30 signals) — consider reducing task load`);
    } else {
      insights.push(`Recent completion rate: ${rate}% (last 30 signals)`);
    }
  }

  // Overwhelm detection — single pass over skip/snooze signals
  const skipsByDate = new Map<string, number>();
  const allSkips = [
    ...mgr.getSignalsByType("task_skipped"),
    ...mgr.getSignalsByType("task_snoozed"),
  ];
  for (const s of allSkips) {
    const date = s.timestamp.split("T")[0];
    skipsByDate.set(date, (skipsByDate.get(date) || 0) + 1);
  }
  let overwhelmDayCount = 0;
  for (const count of skipsByDate.values()) {
    if (count >= 3) overwhelmDayCount++;
  }
  if (overwhelmDayCount >= 2) {
    insights.push(
      `User felt overwhelmed on ${overwhelmDayCount} recent days (3+ skips in a day) — avoid overloading`
    );
  }

  return insights;
}

function buildTimingInsights(memory: MemoryStore): string[] {
  const insights: string[] = [];
  if (memory.taskTimings.length < 3) return insights;

  // Group by category
  const byCategory: Record<
    string,
    { estimated: number[]; actual: number[] }
  > = {};
  for (const t of memory.taskTimings) {
    if (!byCategory[t.taskCategory]) {
      byCategory[t.taskCategory] = { estimated: [], actual: [] };
    }
    byCategory[t.taskCategory].estimated.push(t.estimatedMinutes);
    byCategory[t.taskCategory].actual.push(t.actualMinutes);
  }

  for (const [cat, data] of Object.entries(byCategory)) {
    if (data.actual.length < 2) continue;
    const avgEst = Math.round(
      data.estimated.reduce((a, b) => a + b, 0) / data.estimated.length
    );
    const avgAct = Math.round(
      data.actual.reduce((a, b) => a + b, 0) / data.actual.length
    );
    const diff = avgAct - avgEst;
    if (Math.abs(diff) >= 5) {
      const direction = diff > 0 ? "longer" : "shorter";
      insights.push(
        `"${cat}" tasks: estimated ${avgEst}min, actually take ${avgAct}min (${Math.abs(diff)}min ${direction})`
      );
    }
  }

  return insights;
}

// ── Export summary for UI ───────────────────────────────

export interface MemorySummary {
  totalFacts: number;
  totalPreferences: number;
  totalSignals: number;
  highConfidenceFacts: Array<{ category: string; key: string; value: string }>;
  topPreferences: Array<{ text: string; sentiment: string }>;
  lastReflection: string | null;
  reflectionCount: number;
}

export function getMemorySummary(memory: MemoryStore): MemorySummary {
  const facts = getAllHighConfidenceFacts(memory);
  return {
    totalFacts: memory.facts.length,
    totalPreferences: memory.preferences.length,
    totalSignals: memory.signals.length,
    highConfidenceFacts: facts.slice(0, 10).map((f) => ({
      category: f.category,
      key: f.key,
      value: f.value,
    })),
    topPreferences: memory.preferences
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 10)
      .map((p) => ({
        text: p.text,
        sentiment: p.weight > 0.3 ? "positive" : p.weight < -0.3 ? "negative" : "neutral",
      })),
    lastReflection: memory.lastReflectionAt,
    reflectionCount: memory.reflectionCount,
  };
}

// ── Behavior Profile (human-readable, editable) ─────────

export interface BehaviorProfileEntry {
  id: string;
  category: string;
  text: string;
  source: "observed" | "user-edited";
}

/**
 * Generate a plain-language behavior profile from all memory layers.
 * Returns entries the user can read, understand, and edit.
 */
export function getBehaviorProfile(): BehaviorProfileEntry[] {
  const mgr = getManager();
  const entries: BehaviorProfileEntry[] = [];

  // 1. High-confidence facts → readable sentences
  const facts = mgr.getAllHighConfidenceFacts();
  const categoryLabels: Record<string, string> = {
    schedule: "Schedule",
    preference: "Preferences",
    capacity: "Work capacity",
    motivation: "Motivation",
    pattern: "Patterns",
    constraint: "Constraints",
    strength: "Strengths",
    struggle: "Struggles",
  };

  for (const f of facts) {
    entries.push({
      id: `fact-${f.id}`,
      category: categoryLabels[f.category] || f.category,
      text: f.value,
      source: f.source === "explicit" ? "user-edited" : "observed",
    });
  }

  // 2. Behavioral insights (peak hours, skip patterns, etc.)
  const behavioralInsights = buildBehavioralInsights(mgr);
  const dayInsights = buildDayOfWeekInsights(mgr);
  const timingInsights = buildTimingInsights(mgr.getStore());
  const allInsights = [...behavioralInsights, ...dayInsights, ...timingInsights];

  for (let i = 0; i < allInsights.length; i++) {
    // Clean up internal symbols/formatting
    let text = allInsights[i];
    text = text.replace(/^[⚠️🟢🟡⚪👍👎↔️•\s]+/, "").trim();
    entries.push({
      id: `insight-${i}`,
      category: "Patterns",
      text,
      source: "observed",
    });
  }

  // 3. Top semantic preferences
  const prefs = mgr.getStore().preferences
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15);

  for (const p of prefs) {
    const prefix = p.weight > 0.3 ? "Likes" : p.weight < -0.3 ? "Dislikes" : "Neutral about";
    entries.push({
      id: `pref-${p.id}`,
      category: "Preferences",
      text: `${prefix}: ${p.text}`,
      source: "observed",
    });
  }

  // Deduplicate by text similarity (exact match)
  const seen = new Set<string>();
  const unique: BehaviorProfileEntry[] = [];
  for (const e of entries) {
    const key = e.text.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(e);
    }
  }

  return unique;
}

/**
 * Save user-edited behavior profile entries back to memory.
 * Each entry becomes an explicit fact with high confidence.
 */
export function saveBehaviorProfile(
  entries: Array<{ category: string; text: string }>
): void {
  const mgr = getManager();
  const categoryMap: Record<string, FactCategory> = {
    "Schedule": "schedule",
    "Preferences": "preference",
    "Work capacity": "capacity",
    "Motivation": "motivation",
    "Patterns": "pattern",
    "Constraints": "constraint",
    "Strengths": "strength",
    "Struggles": "struggle",
  };

  // Remove old user-edited facts from the JSON store, then save + reload
  const raw = loadMemory();
  raw.facts = raw.facts.filter((f) => f.source !== "explicit");
  saveMemory(raw);

  // Re-init manager so indices are clean
  _manager = null;
  const freshMgr = getManager();

  // Insert each user-edited entry as an explicit fact
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const factCategory = categoryMap[e.category] || "preference";
    freshMgr.upsertFact(
      factCategory,
      `user_profile_${i}`,
      e.text,
      "User edited in settings",
      "explicit"
    );
  }

  // Persist
  saveMemory(freshMgr.getStore());
}
