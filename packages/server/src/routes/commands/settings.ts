/**
 * Settings, onboarding, and data-management command handlers.
 */

import {
  repos,
  getPool,
  getCurrentUserId,
} from "./_helpers";
import type { UserProfile, UserSettings, TimeBlock } from "./_helpers";

export async function cmdSaveMonthlyContext(
  body: Record<string, unknown>,
): Promise<unknown> {
  const context = body.context as Parameters<
    typeof repos.monthlyContext.upsert
  >[0];
  if (!context || typeof context !== "object") {
    throw new Error("command:save-monthly-context requires args.context");
  }
  await repos.monthlyContext.upsert(context);
  return { ok: true, month: (context as { month: string }).month };
}

export async function cmdDeleteMonthlyContext(
  body: Record<string, unknown>,
): Promise<unknown> {
  const month = body.month as string | undefined;
  if (!month) {
    throw new Error("command:delete-monthly-context requires args.month");
  }
  await repos.monthlyContext.remove(month);
  return { ok: true, month };
}

export async function cmdUpdateSettings(
  body: Record<string, unknown>,
): Promise<unknown> {
  const patch = (body.settings as Partial<UserSettings>) ?? {};
  await repos.users.updateSettings(patch);
  return { ok: true };
}

export async function cmdCompleteOnboarding(
  body: Record<string, unknown>,
): Promise<unknown> {
  // Accepts either a full UserProfile in `body.user` (onboarding finalize)
  // or a partial patch. Full profile → upsert; partial → fall back to
  // completeOnboarding helper with defaults pulled from the current row.
  const patch = (body.user as Partial<UserProfile> | undefined) ?? {};
  const current = await repos.users.get();
  const name = patch.name ?? current?.name ?? "";
  const goalRaw = patch.goalRaw ?? current?.goalRaw ?? "";
  const weeklyAvailability: TimeBlock[] =
    patch.weeklyAvailability ?? current?.weeklyAvailability ?? [];

  // If the caller passed a full profile shape, upsert it whole; otherwise
  // use the narrow completeOnboarding helper.
  if (patch.settings || patch.createdAt) {
    const next: UserProfile = {
      id: current?.id ?? "",
      createdAt: current?.createdAt ?? new Date().toISOString(),
      settings: patch.settings ?? current?.settings ?? ({} as UserSettings),
      ...current,
      ...patch,
      name,
      goalRaw,
      weeklyAvailability,
      onboardingComplete: true,
    };
    await repos.users.upsert(next);
  } else {
    await repos.users.completeOnboarding(name, goalRaw, weeklyAvailability);
  }
  return { ok: true };
}

export async function cmdResetData(): Promise<unknown> {
  const userId = getCurrentUserId();
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Per-entity tables first so FKs (if any) clear cleanly.
    const tables = [
      "goal_plan_nodes",
      "daily_tasks",
      "daily_logs",
      "pending_tasks",
      "heatmap_entries",
      "home_chat_messages",
      "conversations",
      "nudges",
      "behavior_profile_entries",
      "vacation_mode",
      "goals",
      "roadmap",
      "users",
      "app_store",
    ];
    for (const t of tables) {
      await client.query(`delete from ${t} where user_id = $1`, [userId]);
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  return { ok: true };
}
