/* OnboardingPage — designed 7-step conversational flow.
 *
 * Drives the flow from the server view:onboarding — step is server-computed.
 * Wires all 5 contract onboarding commands:
 *   POST /commands/send-onboarding-message
 *   POST /commands/propose-onboarding-goal
 *   POST /commands/confirm-onboarding-goal
 *   POST /commands/accept-onboarding-plan
 *   POST /commands/commit-first-task
 * Plus contract-standard:
 *   POST /commands/update-goal        (step 5 clarificationAnswers)
 *   POST /commands/regenerate-goal-plan (step 6, async)
 *   POST /commands/edit-milestone     (step 6 inline milestone edits)
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import useStore from "../../store/useStore";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import type {
  OnboardingStep,
  OnboardingMessage,
  ProposedOnboardingGoal,
} from "@starward/core";
import Button from "../../components/primitives/Button";
import Icon from "../../components/primitives/Icon";
import { startJob } from "../../components/chrome/JobStatusDock";

interface OnboardingView {
  step: OnboardingStep;
  messages: OnboardingMessage[];
  proposedGoal: ProposedOnboardingGoal | null;
  currentGoalId: string | null;
  firstTaskId: string | null;
  memoryFacts: Array<{ kind?: string; content: string }>;
  memoryPreferences: Array<{ key?: string; value: string }>;
  onboardingComplete: boolean;
  timezone: string | null;
  greetingName: string;
  goalRaw: string;
}

export default function OnboardingPage() {
  const { data, loading, error, refetch } = useQuery<OnboardingView>("view:onboarding");
  const setView = useStore((s) => s.setView);

  if (loading && !data) {
    return (
      <OnbShell>
        <p data-testid="onboarding-loading" style={{ color: "var(--fg-faint)" }}>
          Loading…
        </p>
      </OnbShell>
    );
  }
  if (error) {
    return (
      <OnbShell>
        <pre data-testid="onboarding-error" style={{ color: "var(--danger)" }}>
          error: {String(error)}
        </pre>
      </OnbShell>
    );
  }
  if (!data) {
    return (
      <OnbShell>
        <p>No onboarding data.</p>
      </OnbShell>
    );
  }
  if (data.onboardingComplete || data.step === "complete") {
    return (
      <OnbShell>
        <div
          data-testid="onboarding-complete"
          style={{ padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}
        >
          <Icon name="check" size={28} style={{ color: "var(--success)" }} />
          <h1 className="h-display" style={{ margin: 0, fontSize: 28 }}>
            You're set.
          </h1>
          <p style={{ color: "var(--fg-mute)" }}>Hi {data.greetingName || "there"} — let's start today.</p>
          <Button
            tone="primary"
            iconRight="arrow-right"
            onClick={() => setView("tasks")}
            data-testid="onboarding-go-tasks"
          >
            Go to today
          </Button>
        </div>
      </OnbShell>
    );
  }

  if (data.step === "welcome") return <StepWelcome onChange={refetch} />;
  if (data.step === "discovery")
    return (
      <StepDiscovery
        messages={data.messages}
        memoryFacts={data.memoryFacts}
        memoryPrefs={data.memoryPreferences}
        onChange={refetch}
      />
    );
  if (data.step === "goal-naming")
    return <StepGoalNaming proposed={data.proposedGoal} onChange={refetch} />;
  if (data.step === "clarification")
    return <StepClarification goalId={data.currentGoalId} onChange={refetch} />;
  if (data.step === "plan-reveal")
    return <StepPlanReveal goalId={data.currentGoalId} onChange={refetch} />;
  if (data.step === "first-task")
    return (
      <StepFirstTask
        goalId={data.currentGoalId}
        firstTaskId={data.firstTaskId}
        onChange={refetch}
      />
    );
  return null;
}

// ── Shell ─────────────────────────────────────────────────────

function OnbShell({
  children,
  stepN,
  stepLabel,
  totalN = 5,
  onBack,
}: {
  children: ReactNode;
  stepN?: number;
  stepLabel?: string;
  totalN?: number;
  onBack?: () => void;
}) {
  return (
    <div
      data-testid="onboarding-page"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "18px 28px",
          borderBottom: "1px solid var(--border-soft)",
          background: "var(--bg-elev)",
        }}
      >
        <Icon name="north-star" size={20} style={{ color: "var(--accent)" }} />
        <span className="h-display" style={{ fontSize: 16, color: "var(--fg)" }}>
          Starward
        </span>
        <div style={{ flex: 1 }} />
        {stepN != null && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 10,
                letterSpacing: "0.16em",
                color: "var(--fg-faint)",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              Step {stepN} of {totalN}
              {stepLabel ? ` · ${stepLabel}` : ""}
            </span>
            <div style={{ display: "flex", gap: 5 }}>
              {Array.from({ length: totalN }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: i < stepN ? "var(--accent)" : "var(--bg-sunken)",
                    border: i === stepN - 1 ? "1px solid var(--accent)" : "0",
                  }}
                />
              ))}
            </div>
          </div>
        )}
        {onBack && (
          <button
            onClick={onBack}
            style={{
              marginLeft: 14,
              border: 0,
              background: "transparent",
              color: "var(--fg-faint)",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <Icon name="arrow-left" size={12} /> Back
          </button>
        )}
      </header>
      <div style={{ flex: 1, display: "flex", justifyContent: "center", padding: "40px 24px 80px" }}>
        <div style={{ width: "100%", maxWidth: 680 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Step 1: Welcome ───────────────────────────────────────────

function StepWelcome({ onChange }: { onChange: () => void }) {
  const { run, running, error } = useCommand();
  async function getStarted() {
    try {
      await run("command:send-onboarding-message", { message: "hi" });
      onChange();
    } catch {
      /* error surfaced below */
    }
  }
  return (
    <OnbShell>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 24,
          paddingTop: 48,
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.2em",
            color: "var(--fg-faint)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Welcome
        </div>
        <h1
          className="h-display"
          style={{
            margin: 0,
            fontSize: 44,
            color: "var(--fg)",
            lineHeight: 1.08,
            letterSpacing: "-0.015em",
          }}
        >
          One goal at a time — <span style={{ color: "var(--accent)" }}>actually finished.</span>
        </h1>
        <p
          style={{
            margin: 0,
            fontSize: "var(--t-lg)",
            color: "var(--fg-mute)",
            lineHeight: 1.55,
            maxWidth: 520,
          }}
        >
          The next ten minutes are a conversation, not a form. I'll ask a few questions, help you
          name the goal, build a plan, and hand you the first task for today.
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
          <Button
            tone="primary"
            iconRight="arrow-right"
            onClick={getStarted}
            disabled={running}
            data-api="POST /commands/send-onboarding-message"
            data-testid="onboarding-welcome-start"
          >
            Get started
          </Button>
          <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-faint)" }}>~10 min</span>
        </div>
        {error && (
          <pre
            data-testid="onboarding-welcome-error"
            style={{ color: "var(--danger)", fontSize: 11 }}
          >
            {String(error)}
          </pre>
        )}
      </div>
    </OnbShell>
  );
}

// ── Step 3: Discovery ─────────────────────────────────────────

function StepDiscovery({
  messages,
  memoryFacts,
  memoryPrefs,
  onChange,
}: {
  messages: OnboardingMessage[];
  memoryFacts: Array<{ kind?: string; content: string }>;
  memoryPrefs: Array<{ key?: string; value: string }>;
  onChange: () => void;
}) {
  const { run, running, error } = useCommand();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, running]);

  async function send() {
    if (!draft.trim() || running) return;
    const text = draft;
    setDraft("");
    try {
      await run<{ shouldConclude?: boolean }>("command:send-onboarding-message", { message: text });
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  async function concludeNow() {
    try {
      await run("command:propose-onboarding-goal", {});
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  return (
    <OnbShell stepN={1} totalN={5} stepLabel="Discovery">
      <h1
        className="h-display"
        style={{ margin: "0 0 6px", fontSize: 28, color: "var(--fg)", lineHeight: 1.15 }}
      >
        Let's just talk for a minute.
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: "var(--t-md)", color: "var(--fg-mute)" }}>
        No right answers. Short replies beat long ones.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 240px", gap: 20, alignItems: "start" }}>
        <div
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-elev)",
            display: "flex",
            flexDirection: "column",
            height: 460,
          }}
        >
          <div
            ref={scrollRef}
            data-testid="onboarding-discovery-messages"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: 18,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {messages.length === 0 && (
              <div style={{ color: "var(--fg-faint)", fontSize: "var(--t-sm)", fontStyle: "italic" }}>
                Type a reply below to start the conversation.
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                data-testid={`onboarding-message-${i}`}
                style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}
              >
                <div
                  style={{
                    maxWidth: "82%",
                    padding: "9px 12px",
                    borderRadius: 10,
                    background: m.role === "user" ? "var(--navy)" : "var(--bg)",
                    color: m.role === "user" ? "var(--white)" : "var(--fg)",
                    border: m.role === "user" ? "0" : "1px solid var(--border)",
                    fontSize: "var(--t-sm)",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {running && (
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  color: "var(--fg-faint)",
                  fontSize: "var(--t-xs)",
                  paddingLeft: 2,
                }}
              >
                <span className="dot-blink" />
                <span className="dot-blink" style={{ animationDelay: "0.15s" }} />
                <span className="dot-blink" style={{ animationDelay: "0.3s" }} />
              </div>
            )}
          </div>
          <div
            style={{
              borderTop: "1px solid var(--border)",
              padding: 12,
              display: "flex",
              gap: 8,
            }}
          >
            <input
              data-testid="onboarding-discovery-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Type your reply…"
              style={{
                flex: 1,
                padding: "8px 12px",
                fontSize: "var(--t-sm)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--bg)",
                fontFamily: "inherit",
              }}
            />
            <Button
              tone="primary"
              icon="arrow-right"
              onClick={() => void send()}
              disabled={!draft.trim() || running}
              data-api="POST /commands/send-onboarding-message"
              data-testid="onboarding-discovery-send"
            >
              Send
            </Button>
          </div>
        </div>

        <aside
          data-testid="onboarding-memory-panel"
          style={{
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-elev)",
            padding: 14,
            fontSize: "var(--t-xs)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.14em",
              color: "var(--fg-faint)",
              textTransform: "uppercase",
              fontWeight: 600,
              marginBottom: 10,
            }}
          >
            What I'm learning
          </div>
          {memoryFacts.length === 0 && memoryPrefs.length === 0 && (
            <div style={{ color: "var(--fg-faint)", fontStyle: "italic" }}>
              Nothing yet — reply and I'll pick things up.
            </div>
          )}
          {memoryFacts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-faint)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Facts
              </div>
              {memoryFacts.map((f, i) => (
                <div
                  key={i}
                  style={{
                    padding: "5px 8px",
                    background: "var(--bg)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 3,
                    marginBottom: 4,
                    color: "var(--fg-mute)",
                    lineHeight: 1.35,
                  }}
                >
                  {f.content}
                </div>
              ))}
            </div>
          )}
          {memoryPrefs.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--fg-faint)",
                  marginBottom: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Preferences
              </div>
              {memoryPrefs.map((p, i) => (
                <div
                  key={i}
                  style={{
                    padding: "5px 8px",
                    background: "var(--bg)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: 3,
                    marginBottom: 4,
                    color: "var(--fg-mute)",
                    lineHeight: 1.35,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 6,
                  }}
                >
                  <span style={{ color: "var(--fg-faint)" }}>{p.key}</span>
                  <span>{p.value}</span>
                </div>
              ))}
            </div>
          )}
          {messages.length >= 4 && (
            <div style={{ marginTop: 12 }}>
              <Button
                size="xs"
                tone="primary"
                iconRight="arrow-right"
                onClick={concludeNow}
                data-api="POST /commands/propose-onboarding-goal"
                data-testid="onboarding-discovery-conclude"
                disabled={running}
                style={{ width: "100%", justifyContent: "center" }}
              >
                I'm ready — name the goal
              </Button>
            </div>
          )}
        </aside>
      </div>
      {error && (
        <pre
          data-testid="onboarding-discovery-error"
          style={{ color: "var(--danger)", fontSize: 11, marginTop: 12 }}
        >
          {String(error)}
        </pre>
      )}
    </OnbShell>
  );
}

// ── Step 4: Goal naming ──────────────────────────────────────

function StepGoalNaming({
  proposed,
  onChange,
}: {
  proposed: ProposedOnboardingGoal | null;
  onChange: () => void;
}) {
  const { run, running, error } = useCommand();
  const [title, setTitle] = useState(proposed?.title ?? "");
  const [description, setDescription] = useState(proposed?.description ?? "");
  const [targetDate, setTargetDate] = useState(proposed?.targetDate ?? "");
  const [hoursPerWeek, setHoursPerWeek] = useState(proposed?.hoursPerWeek ?? 3);

  useEffect(() => {
    if (proposed) {
      setTitle(proposed.title);
      setDescription(proposed.description);
      setTargetDate(proposed.targetDate);
      setHoursPerWeek(proposed.hoursPerWeek);
    }
  }, [proposed]);

  async function regenerate() {
    try {
      await run("command:propose-onboarding-goal", {});
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  async function confirm() {
    if (!title.trim()) return;
    try {
      await run("command:confirm-onboarding-goal", {
        title: title.trim(),
        description,
        targetDate: targetDate || undefined,
        hoursPerWeek: Number(hoursPerWeek) || 3,
        metadata: proposed?.metadata ?? {},
      });
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  return (
    <OnbShell stepN={2} totalN={5} stepLabel="Name the goal">
      <h1 className="h-display" style={{ margin: "0 0 6px", fontSize: 28, color: "var(--fg)" }}>
        Here's what I heard.
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: "var(--t-md)", color: "var(--fg-mute)" }}>
        Edit anything that's off. Sharper is better than broader.
      </p>

      {proposed?.rationale && (
        <div
          data-testid="onboarding-goal-rationale"
          style={{
            padding: "10px 12px",
            background: "var(--gold-faint)",
            borderLeft: "3px solid var(--accent)",
            borderRadius: 4,
            fontSize: "var(--t-sm)",
            color: "var(--fg)",
            marginBottom: 16,
            lineHeight: 1.5,
          }}
        >
          {proposed.rationale}
        </div>
      )}

      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-md)",
          background: "var(--bg-elev)",
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <Field label="Goal title">
          <input
            data-testid="onboarding-goal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "var(--t-md)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              fontFamily: "inherit",
              fontWeight: 500,
            }}
          />
        </Field>
        <Field label="Description" hint="One crisp paragraph. What does finishing this mean?">
          <textarea
            data-testid="onboarding-goal-description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: "100%",
              padding: "10px 12px",
              fontSize: "var(--t-sm)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              fontFamily: "inherit",
              resize: "vertical",
              lineHeight: 1.5,
            }}
          />
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Target date">
            <input
              data-testid="onboarding-goal-target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: "var(--t-sm)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--bg)",
              }}
            />
          </Field>
          <Field label="Hours / week">
            <input
              data-testid="onboarding-goal-hours-per-week"
              type="number"
              min={1}
              max={40}
              value={hoursPerWeek}
              onChange={(e) => setHoursPerWeek(Number(e.target.value) || 0)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: "var(--t-sm)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--bg)",
              }}
            />
          </Field>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <Button
          tone="ghost"
          icon="refresh"
          onClick={regenerate}
          data-api="POST /commands/propose-onboarding-goal"
          data-testid="onboarding-goal-regenerate"
          disabled={running}
        >
          Regenerate proposal
        </Button>
        <Button
          tone="primary"
          iconRight="arrow-right"
          disabled={!title.trim() || running}
          onClick={confirm}
          data-api="POST /commands/confirm-onboarding-goal"
          data-testid="onboarding-goal-confirm"
        >
          Confirm goal
        </Button>
      </div>
      {error && (
        <pre
          data-testid="onboarding-goal-error"
          style={{ color: "var(--danger)", fontSize: 11, marginTop: 12 }}
        >
          {String(error)}
        </pre>
      )}
    </OnbShell>
  );
}

const CLARIFIER_QUESTIONS = [
  {
    id: "definition_of_done",
    q: "What does 'done' look like in one sentence? The sharper, the better.",
    placeholder: "e.g. A 70-90k word draft someone could read end-to-end.",
  },
  {
    id: "non_negotiable",
    q: "What's the one thing that, if missing, means this didn't really happen?",
    placeholder: "e.g. A real ending, not just more middle.",
  },
  {
    id: "biggest_risk",
    q: "What's the single biggest risk to finishing?",
    placeholder: "e.g. Losing the arc in the middle third.",
  },
  {
    id: "success_signal",
    q: "Six weeks in, what's a signal you'd use to know you're on track?",
    placeholder: "e.g. Chapters 1-4 drafted; I still believe the premise.",
  },
];

// ── Step 5: Clarification ────────────────────────────────────

function StepClarification({
  goalId,
  onChange,
}: {
  goalId: string | null;
  onChange: () => void;
}) {
  const { run, running, error } = useCommand();
  const [answers, setAnswers] = useState<Record<string, string>>({});

  async function saveAndAdvance() {
    if (!goalId) return;
    try {
      await run("command:update-goal", { id: goalId, updates: { clarificationAnswers: answers } });
      // Kick off the async plan-regeneration job so step 6 has something to show.
      const r = await run<{ jobId?: string }>("command:regenerate-goal-plan", { goalId });
      if (r?.jobId) startJob(r.jobId, "Generating goal plan");
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  return (
    <OnbShell stepN={3} totalN={5} stepLabel="Clarify">
      <h1 className="h-display" style={{ margin: "0 0 6px", fontSize: 28, color: "var(--fg)" }}>
        Four quick questions.
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: "var(--t-md)", color: "var(--fg-mute)" }}>
        These tune the plan to how your goal actually behaves.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {CLARIFIER_QUESTIONS.map((q, i) => (
          <div
            key={q.id}
            style={{
              padding: 16,
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8, lineHeight: 1.45 }}>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: "var(--font-mono)",
                  color: "var(--fg-faint)",
                  paddingTop: 4,
                  flexShrink: 0,
                }}
              >
                Q{i + 1}
              </span>
              <span style={{ fontSize: "var(--t-md)", color: "var(--fg)", fontWeight: 500 }}>{q.q}</span>
            </div>
            <textarea
              data-testid={`onboarding-clarification-${q.id}`}
              rows={2}
              placeholder={q.placeholder}
              value={answers[q.id] || ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: "var(--t-sm)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: "var(--bg)",
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
        <Button
          tone="primary"
          iconRight="arrow-right"
          onClick={saveAndAdvance}
          data-api="POST /commands/update-goal + regenerate-goal-plan"
          data-testid="onboarding-clarification-next"
          disabled={running || !goalId}
        >
          Generate plan
        </Button>
      </div>
      {error && (
        <pre
          data-testid="onboarding-clarification-error"
          style={{ color: "var(--danger)", fontSize: 11, marginTop: 12 }}
        >
          {String(error)}
        </pre>
      )}
    </OnbShell>
  );
}

// ── Step 6: Plan reveal ──────────────────────────────────────

interface PlanViewShape {
  milestones?: Array<{ id: string; title: string; targetDate?: string; due?: string }>;
  plan?: { narrative?: string };
}

function StepPlanReveal({
  goalId,
  onChange,
}: {
  goalId: string | null;
  onChange: () => void;
}) {
  const { run, running, error } = useCommand();
  const { data: planData, refetch: refetchPlan } = useQuery<PlanViewShape>(
    "view:goal-plan",
    goalId ? { goalId } : undefined,
    { enabled: !!goalId },
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");

  async function regenerate() {
    if (!goalId) return;
    try {
      const r = await run<{ jobId?: string }>("command:regenerate-goal-plan", { goalId });
      if (r?.jobId) startJob(r.jobId, "Regenerating goal plan");
      refetchPlan();
    } catch {
      /* error surfaced below */
    }
  }

  async function saveMilestone(id: string) {
    if (!newTitle.trim()) {
      setEditing(null);
      return;
    }
    try {
      await run("command:edit-milestone", { milestoneId: id, newTitle });
      setEditing(null);
      setNewTitle("");
      refetchPlan();
    } catch {
      /* error surfaced below */
    }
  }

  async function accept() {
    if (!goalId) return;
    try {
      await run("command:accept-onboarding-plan", { goalId });
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  const milestones = planData?.milestones ?? [];

  return (
    <OnbShell stepN={4} totalN={5} stepLabel="Plan reveal">
      <h1 className="h-display" style={{ margin: "0 0 6px", fontSize: 28, color: "var(--fg)" }}>
        Your plan.
      </h1>
      <p style={{ margin: "0 0 18px", fontSize: "var(--t-md)", color: "var(--fg-mute)" }}>
        Click any milestone to edit it. Regenerate if you want a different shape.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
        {milestones.length === 0 && (
          <div
            style={{
              padding: 20,
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              textAlign: "center",
              color: "var(--fg-faint)",
            }}
          >
            Generating plan… click <strong>Regenerate</strong> if nothing appears.
          </div>
        )}
        {milestones.map((m) => {
          const isEditing = editing === m.id;
          return (
            <div
              key={m.id}
              data-testid={`onboarding-milestone-${m.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 12,
                alignItems: "center",
                padding: "10px 14px",
                background: "var(--bg-elev)",
                border: isEditing ? "1px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: "var(--r-md)",
                cursor: "pointer",
              }}
              onClick={() => {
                setEditing(m.id);
                setNewTitle(m.title);
              }}
            >
              {isEditing ? (
                <input
                  autoFocus
                  data-testid={`onboarding-milestone-title-${m.id}`}
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onBlur={() => void saveMilestone(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    padding: "4px 8px",
                    fontSize: "var(--t-sm)",
                    border: "1px solid var(--accent)",
                    borderRadius: 3,
                    background: "var(--bg)",
                    fontFamily: "inherit",
                  }}
                />
              ) : (
                <span style={{ fontSize: "var(--t-sm)", color: "var(--fg)", fontWeight: 500 }}>
                  {m.title}
                </span>
              )}
              <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>
                {m.targetDate ?? m.due ?? ""}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Button
          tone="ghost"
          icon="refresh"
          onClick={regenerate}
          data-api="POST /commands/regenerate-goal-plan"
          data-testid="onboarding-plan-regenerate"
          disabled={running || !goalId}
        >
          Regenerate
        </Button>
        <Button
          tone="primary"
          iconRight="arrow-right"
          onClick={accept}
          data-api="POST /commands/accept-onboarding-plan"
          data-testid="onboarding-plan-accept"
          disabled={running || !goalId}
        >
          Accept plan
        </Button>
      </div>
      {error && (
        <pre
          data-testid="onboarding-plan-error"
          style={{ color: "var(--danger)", fontSize: 11, marginTop: 12 }}
        >
          {String(error)}
        </pre>
      )}
    </OnbShell>
  );
}

// ── Step 7: First task ───────────────────────────────────────

function StepFirstTask({
  goalId,
  firstTaskId,
  onChange,
}: {
  goalId: string | null;
  firstTaskId: string | null;
  onChange: () => void;
}) {
  const { run, running, error } = useCommand();
  const [taskTitle, setTaskTitle] = useState("");

  async function commit() {
    try {
      await run("command:commit-first-task", {
        goalId: goalId ?? undefined,
        taskTitle: taskTitle.trim() || undefined,
      });
      onChange();
    } catch {
      /* error surfaced below */
    }
  }

  return (
    <OnbShell stepN={5} totalN={5} stepLabel="First task">
      <h1 className="h-display" style={{ margin: "0 0 6px", fontSize: 28, color: "var(--fg)" }}>
        One task for today.
      </h1>
      <p style={{ margin: "0 0 20px", fontSize: "var(--t-md)", color: "var(--fg-mute)" }}>
        The smallest thing that moves the goal. If you have a title in mind, type it; otherwise
        Starward will seed a suggested task.
      </p>

      <div
        style={{
          padding: 20,
          background: "var(--bg-elev)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--r-md)",
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 10,
            fontSize: 10,
            letterSpacing: "0.14em",
            color: "var(--accent)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          <Icon name="sparkle" size={11} /> Today
          {firstTaskId && (
            <span style={{ color: "var(--fg-faint)", fontFamily: "var(--font-mono)" }}>
              · current: {firstTaskId}
            </span>
          )}
        </div>
        <textarea
          data-testid="onboarding-first-task-title"
          rows={2}
          value={taskTitle}
          onChange={(e) => setTaskTitle(e.target.value)}
          placeholder="Leave blank to use the server's suggested task, or type your own."
          style={{
            width: "100%",
            padding: "10px 12px",
            fontSize: "var(--t-lg)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            background: "var(--bg)",
            fontFamily: "inherit",
            lineHeight: 1.4,
            fontWeight: 500,
            color: "var(--fg)",
            resize: "vertical",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          tone="primary"
          icon="check"
          onClick={commit}
          data-api="POST /commands/commit-first-task"
          data-testid="onboarding-first-task-commit"
          disabled={running}
        >
          Yes, start
        </Button>
      </div>
      {error && (
        <pre
          data-testid="onboarding-first-task-error"
          style={{ color: "var(--danger)", fontSize: 11, marginTop: 12 }}
        >
          {String(error)}
        </pre>
      )}
    </OnbShell>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontSize: 11,
          letterSpacing: "0.08em",
          color: "var(--fg-faint)",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {hint && <span style={{ fontSize: "var(--t-xs)", color: "var(--fg-faint)" }}>{hint}</span>}
      {children}
    </label>
  );
}
