/* TasksPage — bare HTML. view:tasks + every task/reminder/nudge command. */

import { useState } from "react";
import { useQuery } from "../../hooks/useQuery";
import { useCommand } from "../../hooks/useCommand";
import { useReminderNotifications } from "../../hooks/useReminderNotifications";
import type { CommandKind, Reminder } from "@starward/core";

type ExtractedTodo = {
  title: string;
  description?: string;
  durationMinutes?: number;
  priorityHint?: string;
  suggestedDate?: string | null;
  category?: string;
};

type AnalyzeImageResult = {
  result?: {
    imageType?: string;
    summary?: string;
    todos?: ExtractedTodo[];
    ambiguousItems?: Array<{ text: string; reason: string }>;
    suggestedDates?: string[];
  };
};

const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

function stripBase64Prefix(dataUrl: string): string {
  const idx = dataUrl.indexOf("base64,");
  return idx >= 0 ? dataUrl.slice(idx + 7) : dataUrl;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") resolve(stripBase64Prefix(r));
      else reject(new Error("unexpected FileReader result"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function ImageToTodosWidget({
  run,
}: {
  run: <T>(kind: CommandKind, args: Record<string, unknown>) => Promise<T>;
}) {
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState("");
  const [imageType, setImageType] = useState("");
  const [todos, setTodos] = useState<ExtractedTodo[]>([]);
  const [ambiguous, setAmbiguous] = useState<
    Array<{ text: string; reason: string }>
  >([]);
  const [createdIdx, setCreatedIdx] = useState<Set<number>>(new Set());

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_MIME.includes(file.type as (typeof ALLOWED_IMAGE_MIME)[number])) {
      setStatus(`unsupported mime: ${file.type}`);
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setStatus(`image too large: ${file.size} bytes (max ${IMAGE_MAX_BYTES})`);
      return;
    }
    setStatus("reading…");
    let b64: string;
    try {
      b64 = await readFileAsBase64(file);
    } catch (err) {
      setStatus(`read error: ${(err as Error).message}`);
      return;
    }
    setStatus("analyzing…");
    setTodos([]);
    setAmbiguous([]);
    setSummary("");
    setImageType("");
    setCreatedIdx(new Set());
    try {
      const resp = await run<AnalyzeImageResult>("command:analyze-image", {
        imageBase64: b64,
        mediaType: file.type,
        source: "upload",
      });
      const r = resp?.result ?? {};
      setImageType(r.imageType ?? "");
      setSummary(r.summary ?? "");
      setTodos(Array.isArray(r.todos) ? r.todos : []);
      setAmbiguous(Array.isArray(r.ambiguousItems) ? r.ambiguousItems : []);
      setStatus(`ok — ${r.todos?.length ?? 0} todo(s)`);
    } catch (err) {
      setStatus(`error: ${(err as Error).message}`);
    }
  }

  async function addTodo(todo: ExtractedTodo, idx: number) {
    const date =
      (typeof todo.suggestedDate === "string" && todo.suggestedDate) ||
      new Date().toISOString().split("T")[0]!;
    try {
      await run("command:create-task", {
        title: todo.title,
        date,
        durationMinutes: todo.durationMinutes ?? 15,
        payload: {
          description: todo.description ?? "",
          durationMinutes: todo.durationMinutes ?? 15,
          priority: todo.priorityHint ?? "should-do",
          category: todo.category ?? "other",
          source: "image-to-todos",
        },
      });
      setCreatedIdx((prev) => {
        const next = new Set(prev);
        next.add(idx);
        return next;
      });
    } catch (err) {
      setStatus(`create-task error: ${(err as Error).message}`);
    }
  }

  return (
    <div className="image-to-todos-widget" data-testid="image-to-todos-widget">
      <div>
        <strong>command:analyze-image</strong> (image → todos)
      </div>
      <div className="image-to-todos-hint">
        jpg/png/webp, max 5MB. Image is analyzed by Claude and not retained.
      </div>
      <input
        className="image-upload-input"
        data-testid="image-upload"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFile}
      />
      <div data-testid="image-upload-status">status: {status}</div>
      {imageType && <div data-testid="image-upload-type">imageType: <code>{imageType}</code></div>}
      {summary && <div data-testid="image-upload-summary">summary: {summary}</div>}
      {todos.length > 0 && (
        <div data-testid="image-upload-todos">
          <div>extracted todos:</div>
          <ul className="image-todos-list">
            {todos.map((t, i) => (
              <li key={i} className="image-todos-item">
                <strong>{t.title}</strong>
                {t.durationMinutes ? ` — ${t.durationMinutes}min` : ""}
                {t.priorityHint ? ` [${t.priorityHint}]` : ""}
                {t.suggestedDate ? ` (${t.suggestedDate})` : ""}
                {t.description ? <div className="image-todo-description">{t.description}</div> : null}
                <button
                  className="image-todo-add-button"
                  data-testid={`image-todo-add-${i}`}
                  disabled={createdIdx.has(i)}
                  onClick={() => addTodo(t, i)}
                >
                  {createdIdx.has(i) ? "added" : "add"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ambiguous.length > 0 && (
        <div data-testid="image-upload-ambiguous">
          <div>ambiguous items (skipped):</div>
          <ul className="image-ambiguous-list">
            {ambiguous.map((a, i) => (
              <li key={i}>
                <em>{a.text}</em> — {a.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type Args = Record<string, unknown>;

function CmdForm({
  label,
  defaultArgs,
  onRun,
}: {
  label: string;
  defaultArgs: Args;
  onRun: (args: Args) => Promise<void>;
}) {
  const [argsJson, setArgsJson] = useState(JSON.stringify(defaultArgs, null, 2));
  const [status, setStatus] = useState("");
  const slug = label.replace(/^command:/, "").replace(/[^a-z0-9-]/g, "-");
  return (
    <div className="cmd-form" data-testid={`cmd-form-${slug}`}>
      <div><code>{label}</code></div>
      <textarea
        className="cmd-form-textarea"
        data-testid={`cmd-form-args-${slug}`}
        rows={3}
        cols={60}
        value={argsJson}
        onChange={(e) => setArgsJson(e.target.value)}
      />
      <div className="cmd-form-controls">
        <button
          className="cmd-form-run-button"
          data-testid={`cmd-form-run-${slug}`}
          onClick={async () => {
            setStatus("…");
            try {
              await onRun(JSON.parse(argsJson));
              setStatus("ok");
            } catch (e) {
              setStatus(`error: ${(e as Error).message}`);
            }
          }}
        >
          run
        </button>
        <span className="cmd-form-status" data-testid={`cmd-form-status-${slug}`}>&nbsp;{status}</span>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const { data, loading, error, refetch } = useQuery<{ reminders?: Reminder[] }>("view:tasks");
  useReminderNotifications(data?.reminders ?? []);
  const { run } = useCommand();

  const commands: { kind: string; defaults: Args }[] = [
    { kind: "command:toggle-task", defaults: { taskId: "" } },
    { kind: "command:skip-task", defaults: { taskId: "" } },
    { kind: "command:delete-task", defaults: { taskId: "" } },
    { kind: "command:update-task", defaults: { taskId: "", patch: {} } },
    { kind: "command:reschedule-task", defaults: { taskId: "", newDate: "" } },
    { kind: "command:create-task", defaults: { title: "", date: "", durationMinutes: 30 } },
    { kind: "command:delete-tasks-for-date", defaults: { date: "" } },
    { kind: "command:confirm-daily-tasks", defaults: {} },
    { kind: "command:refresh-daily-plan", defaults: {} },
    { kind: "command:regenerate-daily-tasks", defaults: {} },
    { kind: "command:generate-bonus-task", defaults: {} },
    { kind: "command:accept-task-proposal", defaults: { proposalId: "" } },
    { kind: "command:cant-complete-task", defaults: { taskId: "", reason: "" } },
    { kind: "command:defer-overflow", defaults: { taskIds: [] } },
    { kind: "command:undo-defer", defaults: {} },
    { kind: "command:snooze-reschedule", defaults: { goalId: "" } },
    { kind: "command:dismiss-reschedule", defaults: { goalId: "" } },
    { kind: "command:confirm-pending-task", defaults: { pendingTaskId: "" } },
    { kind: "command:reject-pending-task", defaults: { pendingTaskId: "" } },
    { kind: "command:create-pending-task", defaults: { userInput: "" } },
    { kind: "command:upsert-reminder", defaults: { title: "", reminderTime: "", date: "" } },
    { kind: "command:acknowledge-reminder", defaults: { reminderId: "" } },
    { kind: "command:delete-reminder", defaults: { reminderId: "" } },
    { kind: "command:delete-reminders-batch", defaults: { reminderIds: [] } },
    { kind: "command:dismiss-nudge", defaults: { nudgeId: "" } },
    { kind: "command:propose-gap-fillers", defaults: {} },
    { kind: "command:estimate-task-durations", defaults: { taskIds: [] } },
    { kind: "command:set-task-time-block", defaults: { taskId: "", startIso: "", endIso: "" } },
    { kind: "command:submit-priority-feedback", defaults: { taskId: "", signal: "upvote", reason: "" } },
  ];

  return (
    <section className="tasks-page" data-testid="tasks-page">
      <h1>view:tasks</h1>
      {loading && <p data-testid="tasks-loading">loading…</p>}
      {error && <pre data-testid="tasks-error">error: {String(error)}</pre>}
      <pre className="tasks-data" data-testid="tasks-data">{JSON.stringify(data, null, 2)}</pre>
      <button className="tasks-refetch-button" data-testid="tasks-refetch" onClick={refetch}>
        refetch
      </button>

      <h2>image → todos</h2>
      <ImageToTodosWidget run={run} />

      <h2>commands</h2>
      <div className="tasks-commands" data-testid="tasks-commands">
        {commands.map((c) => (
          <CmdForm
            key={c.kind}
            label={c.kind}
            defaultArgs={c.defaults}
            onRun={(args) => run(c.kind as never, args)}
          />
        ))}
      </div>
    </section>
  );
}
