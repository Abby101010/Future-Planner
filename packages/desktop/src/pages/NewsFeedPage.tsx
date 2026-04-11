/* ──────────────────────────────────────────────────────────
   NorthStar — News Feed page
   Curated news and articles related to user's goals.

   Phase 6a: reads goal list + `enableNewsFeed` flag from
   `view:news-feed`. The briefing itself still comes from the
   AI endpoint directly — only view-model data is routed
   through useQuery here.
   ────────────────────────────────────────────────────────── */

import { useState } from "react";
import { Globe, Loader2, RefreshCw } from "lucide-react";
import { useT } from "../i18n";
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

  // News briefing is not wired up in this deployment — the multi-agent
  // research pipeline that produced it never moved to the cloud backend.
  // The page still renders (goals list + empty state) so Settings can
  // toggle the feature without breaking navigation.
  const [briefing] = useState<NewsBriefing | null>(null);
  const loading = false;
  const error: string | null = null;
  const loadNews = () => {};

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
