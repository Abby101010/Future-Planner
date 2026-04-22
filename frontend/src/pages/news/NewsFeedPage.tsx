/* NewsFeedPage — raw JSON dump of view:news-feed. Read-only. */

import { useQuery } from "../../hooks/useQuery";
import useStore from "../../store/useStore";

export default function NewsFeedPage() {
  const researchTopic = useStore((s) => s.researchTopic);
  const args = researchTopic ? { topic: researchTopic } : undefined;
  const { data, loading, error, refetch } = useQuery<unknown>("view:news-feed", args);
  return (
    <section>
      <h1>view:news-feed</h1>
      <p>researchTopic: {researchTopic ?? "(none)"}</p>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>
    </section>
  );
}
