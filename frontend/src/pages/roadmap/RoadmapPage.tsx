/* RoadmapPage — raw JSON dump of view:roadmap. Read-only. */

import { useQuery } from "../../hooks/useQuery";

export default function RoadmapPage() {
  const { data, loading, error, refetch } = useQuery<unknown>("view:roadmap");
  return (
    <section>
      <h1>view:roadmap</h1>
      {loading && <p>loading…</p>}
      {error && <pre>error: {String(error)}</pre>}
      <pre>{JSON.stringify(data, null, 2)}</pre>
      <button onClick={refetch}>refetch</button>
    </section>
  );
}
