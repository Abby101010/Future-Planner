/* NewsFeedPage — designed read-only digest.
 *
 * Per API_CONTRACT (lines 182-185): read-only. The contract does NOT include
 * pin/dismiss/regenerate commands, so those prototype controls are dropped.
 * Visibility is gated by settings.enableNewsFeed (handled by the Sidebar).
 */

import TopBar from "../../components/primitives/TopBar";
import Pill, { type PillTone } from "../../components/primitives/Pill";
import Button from "../../components/primitives/Button";
import { useQuery } from "../../hooks/useQuery";
import useStore from "../../store/useStore";

type NewsKind = "milestone" | "streak" | "nudge" | "external" | "reflection";

interface NewsItem {
  id: string;
  kind: NewsKind;
  title: string;
  body: string;
  when?: string;
  goalIcon?: string;
  source?: string;
  pinned?: boolean;
}

interface NewsFeedView {
  items?: NewsItem[];
  topic?: string;
}

const KIND_TONE: Record<NewsKind, PillTone> = {
  milestone: "success",
  streak: "gold",
  nudge: "warn",
  external: "info",
  reflection: "base",
};

export default function NewsFeedPage() {
  const researchTopic = useStore((s) => s.researchTopic);
  const { data, loading, error, refetch } = useQuery<NewsFeedView>(
    "view:news-feed",
    researchTopic ? { topic: researchTopic } : undefined,
  );

  const items = data?.items ?? [];

  return (
    <>
      <TopBar
        eyebrow="Digest from your goals & the world"
        title="News Feed"
        right={
          <Button
            size="sm"
            tone="ghost"
            icon="refresh"
            onClick={refetch}
            data-api="GET /view/news-feed"
            data-testid="news-refetch"
          >
            Refresh
          </Button>
        }
      />
      <div style={{ maxWidth: 720, margin: "0 auto", width: "100%", padding: "24px 32px 96px" }}>
        {loading && !data && (
          <div data-testid="news-loading" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            Loading feed…
          </div>
        )}
        {error && (
          <div data-testid="news-error" style={{ padding: 20, color: "var(--danger)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {String(error)}
          </div>
        )}
        {!loading && !error && items.length === 0 && (
          <div data-testid="news-empty" style={{ padding: 40, textAlign: "center", color: "var(--fg-faint)" }}>
            Your feed is clear.
          </div>
        )}

        {items.map((f) => (
          <article
            key={f.id}
            data-testid={`news-item-${f.id}`}
            className="ns-row"
            style={{
              display: "flex",
              gap: 14,
              padding: "18px 0",
              borderBottom: "1px solid var(--border-soft)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                {f.goalIcon && <span style={{ fontSize: 16 }}>{f.goalIcon}</span>}
                <Pill tone={KIND_TONE[f.kind]}>{f.kind}</Pill>
                {f.pinned && <Pill icon="target" tone="gold">pinned</Pill>}
                {f.when && (
                  <span className="tnum" style={{ fontSize: 10, color: "var(--fg-faint)" }}>
                    {f.when}
                  </span>
                )}
              </div>
              <h3 style={{ margin: 0, fontSize: "var(--t-lg)", fontWeight: 600, color: "var(--fg)" }}>
                {f.title}
              </h3>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: "var(--t-sm)",
                  color: "var(--fg-mute)",
                  lineHeight: 1.55,
                }}
              >
                {f.body}
              </p>
              {f.source && (
                <div style={{ fontSize: 10, color: "var(--fg-faint)", marginTop: 6 }}>via {f.source}</div>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
