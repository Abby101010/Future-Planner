/* SettingsPage — designed, sectioned settings.
 *
 * Rendered two ways:
 *   - Full-page (standalone) with TopBar + Tabs
 *   - Compact (inside SettingsDialog popup) — single section, no chrome
 *
 * Covers every contract endpoint in the Settings + Memory contract sections:
 *   - GET /view/settings
 *   - POST /commands/update-settings            (general + planning + news-feed)
 *   - POST /commands/set-vacation-mode          (planning)
 *   - POST /commands/save-monthly-context       (monthly)
 *   - POST /commands/delete-monthly-context     (monthly)
 *   - POST /commands/reset-data                 (account danger zone)
 *   - POST /memory/*                            (memory sub-section)
 *   - Supabase SDK signOut                      (account)
 */

import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import { postJson } from "../../services/transport";
import { useAuth } from "../../contexts/AuthContext";
import TopBar from "../../components/primitives/TopBar";
import Tabs from "../../components/primitives/Tabs";
import Button from "../../components/primitives/Button";
import { type IconName } from "../../components/primitives/Icon";
import Pill from "../../components/primitives/Pill";

export type SettingsSection = "general" | "planning" | "memory" | "monthly" | "account";

export interface SettingsPageProps {
  /** Render only one section. Used by SettingsDialog. */
  section?: SettingsSection;
  /** Strip TopBar + Tabs chrome (for popup use). */
  compact?: boolean;
}

interface SettingsShape {
  theme?: "light" | "dark" | "auto";
  timezone?: string;
  enableNewsFeed?: boolean;
  workHoursStart?: string;
  workHoursEnd?: string;
  dailyDigestTime?: string;
  notifications?: boolean;
  language?: "en" | "zh";
}

interface MonthlyContext {
  month: string;
  description?: string;
  context?: string;
}

interface SettingsView {
  user?: {
    settings?: SettingsShape;
    vacationMode?: { active?: boolean };
  } | null;
  settings?: SettingsShape;
  vacationMode?: { active?: boolean };
  monthlyContexts?: MonthlyContext[];
}

const DEFAULT_SETTINGS: SettingsShape = {
  theme: "light",
  timezone: "America/Los_Angeles",
  enableNewsFeed: true,
  workHoursStart: "08:00",
  workHoursEnd: "18:00",
  dailyDigestTime: "07:30",
  notifications: true,
  language: "en",
};

const TABS: Array<{ id: SettingsSection; label: string; icon: IconName }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "planning", label: "Planning", icon: "planning" },
  { id: "memory", label: "Memory", icon: "brain" },
  { id: "monthly", label: "Monthly context", icon: "calendar" },
  { id: "account", label: "Account", icon: "power" },
];

export default function SettingsPage({ section, compact }: SettingsPageProps = {}) {
  const [localTab, setLocalTab] = useState<SettingsSection>("general");
  const tab: SettingsSection = section ?? localTab;
  const { data, refetch } = useQuery<SettingsView>("view:settings");
  const { run, running } = useCommand();
  const [cmdError, setCmdError] = useState<string | null>(null);

  const settings: SettingsShape = { ...DEFAULT_SETTINGS, ...(data?.user?.settings ?? data?.settings ?? {}) };

  async function save(patch: Partial<SettingsShape>) {
    setCmdError(null);
    try {
      await run("command:update-settings", { settings: patch });
      refetch();
    } catch (e) {
      setCmdError((e as Error).message);
    }
  }

  return (
    <>
      {!compact && <TopBar eyebrow="Your preferences & AI memory" title="Settings" />}
      {!compact && <Tabs value={tab} onChange={setLocalTab} tabs={TABS} />}

      <div
        style={
          compact
            ? { padding: "8px 20px 20px", width: "100%" }
            : { maxWidth: 880, margin: "0 auto", width: "100%", padding: "28px 32px 96px" }
        }
      >
        {cmdError && (
          <div
            data-testid="settings-cmd-error"
            style={{ padding: 10, color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}
          >
            {cmdError}
          </div>
        )}

        {tab === "general" && (
          <GeneralSection settings={settings} save={save} running={running} />
        )}
        {tab === "planning" && (
          <PlanningSection
            settings={settings}
            vacationActive={!!(data?.user?.vacationMode?.active ?? data?.vacationMode?.active)}
            save={save}
            run={run}
            running={running}
            refetch={refetch}
            onError={setCmdError}
          />
        )}
        {tab === "memory" && <MemorySection />}
        {tab === "monthly" && (
          <MonthlySection
            months={data?.monthlyContexts ?? []}
            run={run}
            running={running}
            refetch={refetch}
            onError={setCmdError}
          />
        )}
        {tab === "account" && <AccountSection run={run} running={running} onError={setCmdError} />}
      </div>
    </>
  );
}

// ── Shared primitives within Settings ──────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section style={{ paddingBottom: 28, marginBottom: 28, borderBottom: "1px solid var(--border-soft)" }}>
      <header style={{ marginBottom: 14 }}>
        <h3 className="h-headline" style={{ margin: 0, fontSize: "var(--t-xl)" }}>
          {title}
        </h3>
        {subtitle && (
          <p style={{ margin: "3px 0 0", fontSize: "var(--t-sm)", color: "var(--fg-mute)" }}>
            {subtitle}
          </p>
        )}
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "220px 1fr",
        gap: 20,
        alignItems: "center",
        padding: "10px 0",
      }}
    >
      <div>
        <div style={{ fontSize: "var(--t-sm)", fontWeight: 500, color: "var(--fg)" }}>{label}</div>
        {hint && (
          <div style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 2, lineHeight: 1.4 }}>
            {hint}
          </div>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  "data-api": dataApi,
  "data-testid": dataTestid,
}: {
  on: boolean;
  onChange: () => void;
  "data-api"?: string;
  "data-testid"?: string;
}) {
  return (
    <button
      onClick={onChange}
      data-api={dataApi}
      data-testid={dataTestid}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        border: 0,
        cursor: "pointer",
        background: on ? "var(--navy)" : "var(--bg-sunken)",
        padding: 2,
        display: "flex",
        alignItems: "center",
        transition: "background .12s",
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "var(--white)",
          transform: `translateX(${on ? 16 : 0}px)`,
          transition: "transform .12s",
          boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

// ── General section ────────────────────────────────────────────

function GeneralSection({
  settings,
  save,
  running,
}: {
  settings: SettingsShape;
  save: (patch: Partial<SettingsShape>) => Promise<void>;
  running: boolean;
}) {
  return (
    <>
      <Section title="Appearance">
        <Row label="Theme" hint="Will adapt the whole app.">
          <div style={{ display: "flex", gap: 4 }}>
            {(["light", "dark", "auto"] as const).map((v) => (
              <button
                key={v}
                data-testid={`settings-theme-${v}`}
                onClick={() => void save({ theme: v })}
                disabled={running}
                style={{
                  padding: "5px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: settings.theme === v ? "var(--navy)" : "var(--bg-elev)",
                  color: settings.theme === v ? "var(--white)" : "var(--fg)",
                  cursor: "pointer",
                  fontSize: "var(--t-sm)",
                  textTransform: "capitalize",
                }}
              >
                {v}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Timezone">
          <select
            data-testid="settings-timezone"
            value={settings.timezone}
            onChange={(e) => void save({ timezone: e.target.value })}
            data-api="POST /commands/update-settings"
            style={{
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              fontSize: "var(--t-sm)",
            }}
          >
            {["America/Los_Angeles", "America/New_York", "Europe/London", "Asia/Tokyo"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Row>
        <Row label="Language">
          <div style={{ display: "flex", gap: 4 }}>
            {(["en", "zh"] as const).map((l) => (
              <button
                key={l}
                data-testid={`settings-language-${l}`}
                onClick={() => void save({ language: l })}
                disabled={running}
                style={{
                  padding: "5px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  background: settings.language === l ? "var(--navy)" : "var(--bg-elev)",
                  color: settings.language === l ? "var(--white)" : "var(--fg)",
                  cursor: "pointer",
                  fontSize: "var(--t-sm)",
                  textTransform: "uppercase",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Notifications">
        <Row label="Daily digest" hint="Morning brief of today's plan + yesterday's reflection.">
          <Toggle
            on={!!settings.notifications}
            onChange={() => void save({ notifications: !settings.notifications })}
            data-api="POST /commands/update-settings"
            data-testid="settings-notifications-toggle"
          />
        </Row>
        <Row label="Digest time">
          <input
            data-testid="settings-digest-time"
            type="time"
            value={settings.dailyDigestTime}
            onChange={(e) => void save({ dailyDigestTime: e.target.value })}
            data-api="POST /commands/update-settings"
            style={{
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              fontSize: "var(--t-sm)",
            }}
          />
        </Row>
        <Row label="News Feed" hint="The weekly AI-generated digest across all goals.">
          <Toggle
            on={settings.enableNewsFeed !== false}
            onChange={() => void save({ enableNewsFeed: !settings.enableNewsFeed })}
            data-api="POST /commands/update-settings"
            data-testid="settings-news-feed-toggle"
          />
        </Row>
      </Section>
    </>
  );
}

// ── Planning section ───────────────────────────────────────────

function PlanningSection({
  settings,
  vacationActive,
  save,
  run,
  running,
  refetch,
  onError,
}: {
  settings: SettingsShape;
  vacationActive: boolean;
  save: (patch: Partial<SettingsShape>) => Promise<void>;
  run: <T>(kind: never, args: Record<string, unknown>) => Promise<T>;
  running: boolean;
  refetch: () => void;
  onError: (msg: string) => void;
}) {
  async function toggleVacation() {
    try {
      await run("command:set-vacation-mode" as never, { active: !vacationActive });
      refetch();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <>
      <Section title="Work hours" subtitle="Starward won't schedule tasks outside these hours.">
        <Row label="Start">
          <input
            data-testid="settings-work-hours-start"
            type="time"
            value={settings.workHoursStart}
            onChange={(e) => void save({ workHoursStart: e.target.value })}
            data-api="POST /commands/update-settings"
            style={{
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              fontSize: "var(--t-sm)",
            }}
          />
        </Row>
        <Row label="End">
          <input
            data-testid="settings-work-hours-end"
            type="time"
            value={settings.workHoursEnd}
            onChange={(e) => void save({ workHoursEnd: e.target.value })}
            data-api="POST /commands/update-settings"
            style={{
              padding: "6px 10px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              fontSize: "var(--t-sm)",
            }}
          />
        </Row>
      </Section>

      <Section title="Vacation mode" subtitle="Pause all goals, clear today's plan, suppress pace-nudges.">
        <Row label="Status" hint={vacationActive ? "Active — resume anytime." : "All goals running normally."}>
          <Button
            size="sm"
            tone={vacationActive ? "base" : "primary"}
            onClick={toggleVacation}
            data-api="POST /commands/set-vacation-mode"
            data-testid="settings-vacation-toggle"
            disabled={running}
          >
            {vacationActive ? "Disable vacation mode" : "Enable vacation mode"}
          </Button>
        </Row>
      </Section>
    </>
  );
}

// ── Memory section ─────────────────────────────────────────────

type MemEndpoint =
  | "/memory/load"
  | "/memory/summary"
  | "/memory/nudges"
  | "/memory/behavior-profile"
  | "/memory/save-behavior-profile"
  | "/memory/should-reflect"
  | "/memory/reflect"
  | "/memory/clear";

function MemorySection() {
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [behaviorBody, setBehaviorBody] = useState("{}");
  const [confirmClear, setConfirmClear] = useState(false);

  async function call(path: MemEndpoint, body: unknown = {}) {
    setErrors((e) => ({ ...e, [path]: "" }));
    try {
      const r = await postJson<unknown>(path, body);
      setResults((s) => ({ ...s, [path]: r }));
    } catch (e) {
      setErrors((s) => ({ ...s, [path]: (e as Error).message }));
    }
  }

  const loadButtons: Array<{ path: MemEndpoint; icon: IconName; label: string }> = [
    { path: "/memory/load", icon: "refresh", label: "Load memory" },
    { path: "/memory/summary", icon: "sparkle", label: "Summary" },
    { path: "/memory/nudges", icon: "bell", label: "Nudges" },
    { path: "/memory/should-reflect", icon: "bolt", label: "Should reflect?" },
  ];

  return (
    <>
      <Section title="Memory store" subtitle="Facts, preferences, and signals Starward has learned. Populated automatically by the AI.">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {loadButtons.map((b) => (
            <Button
              key={b.path}
              size="sm"
              tone="ghost"
              icon={b.icon}
              onClick={() => void call(b.path)}
              data-api={`POST ${b.path}`}
              data-testid={`memory-${b.path.replace(/^\/memory\//, "")}`}
            >
              {b.label}
            </Button>
          ))}
        </div>
        {loadButtons.map((b) => {
          if (!(b.path in results) && !errors[b.path]) return null;
          return (
            <div
              key={`${b.path}-result`}
              data-testid={`memory-result-${b.path.replace(/^\/memory\//, "")}`}
              style={{
                marginTop: 6,
                padding: 8,
                background: "var(--bg-sunken)",
                borderRadius: 4,
                border: "1px solid var(--border-soft)",
              }}
            >
              <div style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--fg-faint)", marginBottom: 4 }}>
                {b.path}
              </div>
              {errors[b.path] ? (
                <pre style={{ margin: 0, fontSize: 10, color: "var(--danger)" }}>{errors[b.path]}</pre>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--fg-mute)",
                    maxHeight: 200,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(results[b.path], null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </Section>

      <Section title="Behavior profile" subtitle="A compact picture of how you actually work. Updated by reflection passes.">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Button
            size="sm"
            tone="ghost"
            icon="settings"
            onClick={() => void call("/memory/behavior-profile")}
            data-api="POST /memory/behavior-profile"
            data-testid="memory-behavior-get"
          >
            Get profile
          </Button>
          <Button
            size="sm"
            tone="ghost"
            icon="sparkle"
            onClick={() => void call("/memory/reflect")}
            data-api="POST /memory/reflect"
            data-testid="memory-reflect"
          >
            Run reflection
          </Button>
        </div>
        <textarea
          data-testid="memory-behavior-json"
          rows={3}
          value={behaviorBody}
          onChange={(e) => setBehaviorBody(e.target.value)}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            padding: 6,
            border: "1px solid var(--border)",
            borderRadius: 3,
          }}
        />
        <Button
          size="sm"
          tone="primary"
          icon="check"
          onClick={() => {
            try {
              void call("/memory/save-behavior-profile", JSON.parse(behaviorBody));
            } catch (e) {
              setErrors((s) => ({
                ...s,
                "/memory/save-behavior-profile": `JSON parse: ${(e as Error).message}`,
              }));
            }
          }}
          data-api="POST /memory/save-behavior-profile"
          data-testid="memory-behavior-save"
        >
          Save profile
        </Button>
        {errors["/memory/save-behavior-profile"] && (
          <pre
            data-testid="memory-behavior-save-error"
            style={{ color: "var(--danger)", fontSize: 10 }}
          >
            {errors["/memory/save-behavior-profile"]}
          </pre>
        )}
      </Section>

      <Section title="Danger zone" subtitle="Clears every fact, preference, signal, and session.">
        <Row label="Clear all memory">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: "var(--t-sm)", color: "var(--fg-mute)", display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                data-testid="memory-clear-confirm"
                checked={confirmClear}
                onChange={(e) => setConfirmClear(e.target.checked)}
              />
              I understand
            </label>
            <Button
              size="sm"
              tone="danger"
              icon="trash"
              disabled={!confirmClear}
              onClick={() => void call("/memory/clear")}
              data-api="POST /memory/clear"
              data-testid="memory-clear-run"
            >
              Clear memory
            </Button>
          </div>
        </Row>
      </Section>
    </>
  );
}

// ── Monthly section ────────────────────────────────────────────

function MonthlySection({
  months,
  run,
  running,
  refetch,
  onError,
}: {
  months: MonthlyContext[];
  run: <T>(kind: never, args: Record<string, unknown>) => Promise<T>;
  running: boolean;
  refetch: () => void;
  onError: (msg: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newMonth, setNewMonth] = useState("");
  const [newContext, setNewContext] = useState("");

  useEffect(() => {
    const map: Record<string, string> = {};
    for (const m of months) map[m.month] = m.description ?? m.context ?? "";
    setDrafts(map);
  }, [months]);

  async function save(month: string) {
    try {
      await run("command:save-monthly-context" as never, {
        month,
        description: drafts[month] ?? "",
      });
      refetch();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function del(month: string) {
    if (!window.confirm(`Delete monthly context for ${month}?`)) return;
    try {
      await run("command:delete-monthly-context" as never, { month });
      refetch();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function addNew() {
    if (!newMonth.trim()) return;
    try {
      await run("command:save-monthly-context" as never, {
        month: newMonth.trim(),
        description: newContext,
      });
      setNewMonth("");
      setNewContext("");
      refetch();
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <Section title="Monthly context" subtitle="Tell Starward what each month looks like (travel, deadlines, capacity). Used when planning.">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {months.length === 0 && (
          <div style={{ padding: 14, color: "var(--fg-faint)", fontSize: "var(--t-sm)" }}>
            No monthly context saved yet.
          </div>
        )}
        {months.map((m) => (
          <div
            key={m.month}
            data-testid={`monthly-context-${m.month}`}
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-md)",
              padding: "14px 16px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: "var(--t-md)", fontWeight: 600, color: "var(--fg)" }}>{m.month}</span>
              <Pill mono>monthly-context</Pill>
            </div>
            <textarea
              data-testid={`monthly-context-textarea-${m.month}`}
              value={drafts[m.month] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [m.month]: e.target.value }))}
              rows={2}
              style={{
                width: "100%",
                border: "1px solid var(--border)",
                borderRadius: 4,
                padding: "8px 10px",
                fontSize: "var(--t-sm)",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 6 }}>
              <Button
                size="xs"
                tone="primary"
                icon="check"
                onClick={() => void save(m.month)}
                data-api="POST /commands/save-monthly-context"
                data-testid={`monthly-save-${m.month}`}
                disabled={running}
              >
                Save
              </Button>
              <Button
                size="xs"
                tone="danger"
                icon="trash"
                onClick={() => void del(m.month)}
                data-api="POST /commands/delete-monthly-context"
                data-testid={`monthly-delete-${m.month}`}
                disabled={running}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}

        <div
          style={{
            marginTop: 8,
            padding: 14,
            border: "1px dashed var(--border-strong)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-sunken)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-faint)", fontWeight: 600 }}>
            Add month
          </div>
          <input
            data-testid="monthly-new-month"
            value={newMonth}
            onChange={(e) => setNewMonth(e.target.value)}
            placeholder="Month (e.g. '2026-05' or 'June 2025')"
            style={{
              padding: "6px 10px",
              fontSize: "var(--t-sm)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
            }}
          />
          <textarea
            data-testid="monthly-new-context"
            rows={2}
            value={newContext}
            onChange={(e) => setNewContext(e.target.value)}
            placeholder="What's happening this month — travel, deadlines, capacity…"
            style={{
              padding: "6px 10px",
              fontSize: "var(--t-sm)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg)",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <Button
            size="sm"
            tone="primary"
            icon="plus"
            onClick={addNew}
            data-api="POST /commands/save-monthly-context"
            data-testid="monthly-new-submit"
            disabled={running || !newMonth.trim()}
            style={{ alignSelf: "flex-end" }}
          >
            Add month
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ── Account section ────────────────────────────────────────────

function AccountSection({
  run,
  running,
  onError,
}: {
  run: <T>(kind: never, args: Record<string, unknown>) => Promise<T>;
  running: boolean;
  onError: (msg: string) => void;
}) {
  const { signOut } = useAuth();
  const [confirmReset, setConfirmReset] = useState(false);

  async function handleReset() {
    if (!confirmReset) return;
    try {
      await run("command:reset-data" as never, {});
      setConfirmReset(false);
    } catch (e) {
      onError((e as Error).message);
    }
  }

  return (
    <>
      <Section title="Session">
        <Row label="Sign out" hint="Ends your Supabase session on this device.">
          <Button
            size="sm"
            onClick={() => void signOut()}
            data-api="Supabase SDK: signOut"
            data-testid="settings-sign-out"
          >
            Sign out
          </Button>
        </Row>
      </Section>

      <Section
        title="Danger zone"
        subtitle="Permanently wipes all goals, tasks, plans, memory, and sessions for this account."
      >
        <Row
          label="Reset all data"
          hint={
            confirmReset
              ? "Confirmed — click 'Reset data' to proceed."
              : "Check the box to enable the button."
          }
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: "var(--t-sm)",
                color: "var(--fg-mute)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                data-testid="settings-reset-confirm"
                checked={confirmReset}
                onChange={(e) => setConfirmReset(e.target.checked)}
              />
              I understand this is irreversible
            </label>
            <Button
              size="sm"
              tone="danger"
              icon="trash"
              onClick={handleReset}
              disabled={!confirmReset || running}
              data-api="POST /commands/reset-data"
              data-testid="settings-reset-run"
            >
              Reset data
            </Button>
          </div>
        </Row>
      </Section>
    </>
  );
}
