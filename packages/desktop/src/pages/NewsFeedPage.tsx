/* ──────────────────────────────────────────────────────────
   NorthStar — News Feed page
   Curated news and articles related to user's goals.

   Phase 6a: reads goal list + `enableNewsFeed` flag from
   `view:news-feed`. The briefing itself still comes from the
   AI endpoint directly — only view-model data is routed
   through useQuery here.
   ────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";
import { Globe, Loader2, RefreshCw } from "lucide-react";
import { useT } from "../i18n";
import { fetchNewsBriefing } from "../services/ai";
import { useQuery } from "../hooks/useQuery";
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

  const goals = data?.goals ?? [];

  const [briefing, setBriefing] = useState<NewsBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNews = async () => {
    if (goals.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const goalTitles = goals.map((g) => g.title);
      const result = await fetchNewsBriefing(goalTitles, []);
      if (result.ok && result.data) {
        setBriefing(result.data);
      } else {
        setError(result.error || "Failed to load news");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load news");
    } finally {
      setLoading(false);
    }
  };

  // Fetch the briefing once the view has loaded and we know we have goals.
  useEffect(() => {
    if (!data) return;
    if (goals.length === 0) return;
    loadNews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.goals.length]);

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
            <Globe size={20} /> {t.agents.newsTitle}
          </h2>
          <button
            className="btn btn-ghost btn-sm"
            onClick={loadNews}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} /> Refresh
          </button>
        </div>

        {loading && !briefing && (
          <div className="newsfeed-loading">
            <Loader2 size={18} className="spin" />
            <span>{t.agents.newsLoading}</span>
          </div>
        )}

        {error && (
          <div className="newsfeed-error">
            <p>{error}</p>
          </div>
        )}

        {goals.length === 0 && !loading && (
          <div className="newsfeed-empty">
            <p>Add some goals first — your news feed is curated based on what you're working toward.</p>
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
              {(briefing.articles as Array<{
                title: string;
                source: string;
                url: string;
                summary: string;
                relevance: string;
              }>).map((article, i) => (
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
