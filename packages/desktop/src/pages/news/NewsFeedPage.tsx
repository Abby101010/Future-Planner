/* ──────────────────────────────────────────────────────────
   NorthStar — News Feed page
   Curated insights and tips related to user's goals.

   Goal list comes from `view:news-feed`. The briefing is
   generated on-demand via the `ai:news-briefing` sub-agent.

   When the user asks the home chat to "research X", the store's
   `researchTopic` is set and this page auto-loads a focused
   research briefing on that topic instead of the default feed.
   ────────────────────────────────────────────────────────── */

import { useState, useCallback, useEffect, useRef } from "react";
import { Globe, Loader2, RefreshCw, Search } from "lucide-react";
import { useT } from "../../i18n";
import useStore from "../../store/useStore";
import { useQuery } from "../../hooks/useQuery";
import { fetchNewsBriefing } from "../../services/ai";
import type { NewsBriefing, Goal } from "@northstar/core";
import "./NewsFeedPage.css";

// MUST match packages/server/src/views/newsFeedView.ts
interface NewsFeedView {
  goals: Goal[];
  enableNewsFeed: boolean;
}

export default function NewsFeedPage() {
  const { data, loading: viewLoading, error: viewError, refetch } =
    useQuery<NewsFeedView>("view:news-feed");
  const t = useT();

  const researchTopic = useStore((s) => s.researchTopic);
  const setResearchTopic = useStore((s) => s.setResearchTopic);

  const goals = data?.goals ?? [];

  const [briefing, setBriefing] = useState<NewsBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const loadNews = useCallback(async (topic?: string) => {
    if (goals.length === 0 && !topic) return;
    setLoading(true);
    setError(null);
    setActiveTopic(topic ?? null);
    try {
      const result = await fetchNewsBriefing(
        goals.map((g) => ({
          id: g.id,
          title: g.title,
          description: g.description,
          targetDate: g.targetDate,
          isHabit: g.isHabit,
        })),
        topic,
      );
      setBriefing(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load insights");
    } finally {
      setLoading(false);
    }
  }, [goals]);

  // Consume researchTopic from store — auto-trigger focused research
  const consumedTopicRef = useRef<string | null>(null);
  useEffect(() => {
    if (researchTopic && researchTopic !== consumedTopicRef.current && goals.length > 0) {
      consumedTopicRef.current = researchTopic;
      setResearchTopic(null); // clear so it doesn't re-trigger
      loadNews(researchTopic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchTopic, goals.length]);

  // Auto-load default insights on first render when goals are available
  // (only if no research topic was set)
  useEffect(() => {
    if (goals.length > 0 && !briefing && !loading && !error && !researchTopic) {
      loadNews();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals.length]);

  if (viewLoading && !data) {
    return (
      <div className="newsfeed-page">
        <div className="newsfeed-scroll">
          <div className="newsfeed-loading">
            <Loader2 size={18} className="spin" />
            <span>{t.common.loading}</span>
          </div>
        </div>
      </div>
    );
  }

  if (viewError) {
    return (
      <div className="newsfeed-page">
        <div className="newsfeed-scroll">
          <div className="newsfeed-error">
            <p>{viewError.message}</p>
            <button className="btn btn-ghost btn-sm" onClick={refetch}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="newsfeed-page">
      <div className="newsfeed-scroll">
        <div className="newsfeed-header">
          <h2>
            {activeTopic ? <Search size={20} /> : <Globe size={20} />}{" "}
            {activeTopic ? `Research: ${activeTopic}` : t.agents.newsTitle}
          </h2>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => loadNews(activeTopic ?? undefined)}
            disabled={loading || goals.length === 0}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
          {activeTopic && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setActiveTopic(null);
                loadNews();
              }}
              disabled={loading}
            >
              <Globe size={14} /> All Insights
            </button>
          )}
        </div>

        {loading && !briefing && (
          <div className="newsfeed-loading">
            <Loader2 size={18} className="spin" />
            <span>{activeTopic ? `Researching "${activeTopic}"…` : t.agents.newsLoading}</span>
          </div>
        )}

        {error && (
          <div className="newsfeed-error">
            <p>{error}</p>
            <button className="btn btn-ghost btn-sm" onClick={() => loadNews(activeTopic ?? undefined)}>
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        )}

        {goals.length === 0 && !loading && (
          <div className="newsfeed-empty">
            <p>Add some goals first — your insights feed is curated based on what you're working toward.</p>
          </div>
        )}

        {briefing && briefing.articles && briefing.articles.length > 0 && (
          <>
            {briefing.summary && (
              <div className="newsfeed-summary">
                <p>{briefing.summary}</p>
              </div>
            )}

            <div className="newsfeed-articles">
              {briefing.articles.map((article, i) => (
                <div key={i} className="newsfeed-article card">
                  <div className="newsfeed-article-header">
                    <span className="newsfeed-article-title">{article.title}</span>
                    <span className="newsfeed-article-source">{article.source}</span>
                  </div>
                  <p className="newsfeed-article-summary">{article.summary}</p>
                  {article.relevance && (
                    <p className="newsfeed-article-relevance">{article.relevance}</p>
                  )}
                </div>
              ))}
            </div>

            {briefing.relevanceNote && (
              <p className="newsfeed-relevance-note">{briefing.relevanceNote}</p>
            )}
          </>
        )}

        {!loading && briefing && (!briefing.articles || briefing.articles.length === 0) && (
          <div className="newsfeed-empty">
            <p>{t.agents.newsEmpty}</p>
          </div>
        )}
      </div>
    </div>
  );
}
