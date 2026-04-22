/* MemoryPage — raw controls for user-facing /memory/* routes. */

import { useState } from "react";
import { postJson } from "../../services/transport";

type Endpoint =
  | "/memory/load"
  | "/memory/summary"
  | "/memory/nudges"
  | "/memory/behavior-profile"
  | "/memory/save-behavior-profile"
  | "/memory/should-reflect"
  | "/memory/reflect"
  | "/memory/clear";

const VIEW_ENDPOINTS: Endpoint[] = [
  "/memory/load",
  "/memory/summary",
  "/memory/nudges",
  "/memory/behavior-profile",
  "/memory/should-reflect",
];

const ACTION_ENDPOINTS: Endpoint[] = ["/memory/reflect", "/memory/save-behavior-profile"];

export default function MemoryPage() {
  const [results, setResults] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [behaviorBody, setBehaviorBody] = useState("{}");
  const [confirmClear, setConfirmClear] = useState(false);

  async function call(path: Endpoint, body: unknown = {}) {
    setErrors((e) => ({ ...e, [path]: "" }));
    try {
      const r = await postJson<unknown>(path, body);
      setResults((s) => ({ ...s, [path]: r }));
    } catch (e) {
      setErrors((s) => ({ ...s, [path]: (e as Error).message }));
    }
  }

  return (
    <section className="memory-page" data-testid="memory-page">
      <h1>memory</h1>

      <section data-testid="memory-view-endpoints">
        <h2>fetch</h2>
        {VIEW_ENDPOINTS.map((path) => {
          const slug = path.replace(/^\/memory\//, "");
          return (
            <div key={path} className="memory-endpoint-row" data-testid={`memory-row-${slug}`}>
              <button data-testid={`memory-run-${slug}`} onClick={() => call(path)}>
                POST {path}
              </button>
              {errors[path] && (
                <pre data-testid={`memory-error-${slug}`}>error: {errors[path]}</pre>
              )}
              {path in results && (
                <pre data-testid={`memory-result-${slug}`}>
                  {JSON.stringify(results[path], null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </section>

      <section data-testid="memory-behavior-profile">
        <h2>save-behavior-profile</h2>
        <textarea
          className="memory-behavior-textarea"
          data-testid="memory-behavior-args"
          rows={4}
          cols={60}
          value={behaviorBody}
          onChange={(e) => setBehaviorBody(e.target.value)}
        />
        <div>
          <button
            data-testid="memory-run-save-behavior-profile"
            onClick={() => {
              try {
                const parsed = JSON.parse(behaviorBody);
                void call("/memory/save-behavior-profile", parsed);
              } catch (e) {
                setErrors((s) => ({
                  ...s,
                  "/memory/save-behavior-profile": `JSON parse: ${(e as Error).message}`,
                }));
              }
            }}
          >
            POST /memory/save-behavior-profile
          </button>
        </div>
      </section>

      <section data-testid="memory-reflect">
        <h2>reflect</h2>
        <button data-testid="memory-run-reflect" onClick={() => call("/memory/reflect")}>
          POST /memory/reflect
        </button>
      </section>

      <details data-testid="memory-danger-zone">
        <summary>danger zone: /memory/clear</summary>
        <label>
          <input
            type="checkbox"
            data-testid="memory-clear-confirm"
            checked={confirmClear}
            onChange={(e) => setConfirmClear(e.target.checked)}
          />
          I understand this wipes all memory
        </label>
        <button
          disabled={!confirmClear}
          data-testid="memory-run-clear"
          onClick={() => call("/memory/clear")}
        >
          POST /memory/clear
        </button>
      </details>

      {Object.keys(errors).length > 0 && (
        <section data-testid="memory-all-errors">
          <h2>errors</h2>
          <pre>{JSON.stringify(errors, null, 2)}</pre>
        </section>
      )}
      {ACTION_ENDPOINTS.some((p) => p in results) && (
        <section data-testid="memory-action-results">
          <h2>action results</h2>
          <pre>
            {JSON.stringify(
              Object.fromEntries(ACTION_ENDPOINTS.filter((p) => p in results).map((p) => [p, results[p]])),
              null,
              2,
            )}
          </pre>
        </section>
      )}
    </section>
  );
}
