/* NorthStar — app_store table (key/value JSON store) */

import { getDB } from "./connection";

export async function loadAppData(): Promise<Record<string, unknown>> {
  const d = getDB();
  const rows = d.prepare("SELECT key, value FROM app_store").all() as Array<{
    key: string;
    value: string;
  }>;
  const data: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      data[row.key] = JSON.parse(row.value);
    } catch {
      data[row.key] = row.value;
    }
  }
  return data;
}

export async function saveAppData(
  data: Record<string, unknown>,
): Promise<void> {
  const d = getDB();
  const upsert = d.prepare(
    `INSERT INTO app_store (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
  );
  const saveTxn = d.transaction(() => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      upsert.run(key, JSON.stringify(value));
    }
  });
  saveTxn();
}
