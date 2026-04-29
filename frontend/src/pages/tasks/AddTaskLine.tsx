/* AddTaskLine — minimalist single-line task composer.
 *
 * Two paths per contract:
 *   type + Enter / Add             → POST /commands/create-task
 *   open "Image" + upload + Analyze → POST /commands/analyze-image →
 *     then per extracted todo: POST /commands/create-task
 */

import { useState } from "react";
import { useCommand } from "../../hooks/useCommand";
import Button from "../../components/primitives/Button";
import Icon from "../../components/primitives/Icon";

interface ExtractedTodo {
  id: string;
  title: string;
  estimatedDurationMinutes?: number;
}

interface AnalyzeImageResult {
  todos?: ExtractedTodo[];
  extractedTodos?: ExtractedTodo[];
}

export interface AddTaskLineProps {
  onAdded: () => void;
}

export default function AddTaskLine({ onAdded }: AddTaskLineProps) {
  const { run, running } = useCommand();
  const [draft, setDraft] = useState("");
  const [focus, setFocus] = useState(false);
  const [imgOpen, setImgOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [extracted, setExtracted] = useState<ExtractedTodo[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function createTask() {
    if (!draft.trim()) return;
    setError(null);
    try {
      await run("command:create-task", { title: draft.trim() });
      setDraft("");
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function analyzeImage() {
    if (!file) return;
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64 = btoa(binary);
      const result = await run<AnalyzeImageResult>("command:analyze-image", {
        imageBase64: base64,
        mediaType: file.type || "image/png",
        source: file.name,
      });
      setExtracted(result.extractedTodos ?? result.todos ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addExtracted(todo: ExtractedTodo) {
    setError(null);
    try {
      await run("command:create-task", {
        title: todo.title,
        durationMinutes: todo.estimatedDurationMinutes,
      });
      setExtracted((arr) => arr.filter((t) => t.id !== todo.id));
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section data-testid="add-task-line">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 2px 12px",
          borderBottom: `1px solid ${focus ? "var(--navy-mid)" : "var(--border-soft)"}`,
          transition: "border-color .15s ease",
        }}
      >
        <Icon
          name="plus"
          size={15}
          style={{
            color: focus ? "var(--navy-mid)" : "var(--fg-faint)",
            flexShrink: 0,
            transition: "color .15s",
          }}
        />
        <input
          data-testid="add-task-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          placeholder="Add a task…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) void createTask();
          }}
          data-api="POST /commands/create-task"
          style={{
            flex: 1,
            minWidth: 0,
            padding: "4px 0",
            border: 0,
            outline: "none",
            background: "transparent",
            fontSize: "var(--t-lg)",
            color: "var(--user-color)",
            fontFamily: "inherit",
          }}
        />
        <button
          data-testid="add-task-image-toggle"
          onClick={() => setImgOpen((o) => !o)}
          title="Add from image"
          style={{
            border: 0,
            background: imgOpen ? "var(--bg-soft)" : "transparent",
            cursor: "pointer",
            color: imgOpen ? "var(--navy-deep)" : "var(--fg-faint)",
            padding: 4,
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          <Icon name="image" size={12} /> Image
        </button>
        {draft.trim() && (
          <button
            data-testid="add-task-submit"
            onClick={createTask}
            disabled={running}
            data-api="POST /commands/create-task"
            style={{
              border: 0,
              background: "var(--navy-deep)",
              color: "var(--white)",
              cursor: "pointer",
              padding: "6px 12px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: "0.04em",
            }}
          >
            Add
          </button>
        )}
      </div>

      {imgOpen && (
        <div
          data-testid="add-task-image-panel"
          style={{
            marginTop: 12,
            padding: 14,
            border: "1px solid var(--border)",
            borderRadius: "var(--r-md)",
            background: "var(--bg-elev)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label
              style={{
                flex: "1 1 240px",
                minWidth: 0,
                border: "1px dashed var(--border-strong)",
                borderRadius: 4,
                padding: "10px 14px",
                cursor: "pointer",
                background: "var(--bg-soft)",
                fontSize: "var(--t-sm)",
                color: "var(--fg-mute)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <Icon name="image" size={13} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {file ? file.name : "Select an image (jpg / png / webp, 5MB)"}
              </span>
              <input
                type="file"
                data-testid="add-task-image-file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: "none" }}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Button
              size="sm"
              tone="primary"
              icon="sparkle"
              onClick={analyzeImage}
              disabled={!file || running}
              data-api="POST /commands/analyze-image"
              data-testid="add-task-image-analyze"
            >
              Analyze
            </Button>
            <Button
              size="sm"
              tone="ghost"
              icon="x"
              onClick={() => {
                setImgOpen(false);
                setFile(null);
                setExtracted([]);
              }}
            >
              Close
            </Button>
          </div>
          {extracted.length > 0 && (
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border-soft)", paddingTop: 10 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--fg-faint)",
                  fontWeight: 600,
                  marginBottom: 6,
                }}
              >
                Extracted todos ({extracted.length})
              </div>
              {extracted.map((x) => (
                <div
                  key={x.id}
                  data-testid={`extracted-todo-${x.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 0",
                    borderBottom: "1px solid var(--border-soft)",
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "var(--t-sm)",
                      color: "var(--user-color)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {x.title}
                  </span>
                  <Button
                    size="xs"
                    icon="plus"
                    onClick={() => addExtracted(x)}
                    data-api="POST /commands/create-task"
                    data-testid={`extracted-add-${x.id}`}
                    disabled={running}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          data-testid="add-task-error"
          style={{ marginTop: 6, color: "var(--danger)", fontSize: 11, fontFamily: "var(--font-mono)" }}
        >
          {error}
        </div>
      )}
    </section>
  );
}
