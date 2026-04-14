/* NorthStar server — users repository
 *
 * Wraps the `users` table (migration 0004). Exactly one row per user
 * (PK is user_id alone). Replaces the legacy `app_store.user` JSON blob.
 *
 * Stable identity + onboarding fields are columns; profile extras
 * (age, currentRole, education, location, etc.) round-trip through the
 * `payload` jsonb column. Settings, weeklyAvailability, and
 * deviceIntegrations each get their own typed jsonb column because
 * they are read/written as cohesive units by their own commands.
 *
 * Partial updates use COALESCE on the parameter so callers can pass
 * null for fields they don't want to touch — this is what makes
 * `cmdUpdateSettings` atomic (no read-merge-write).
 */

import type {
  TimeBlock,
  UserProfile,
  UserSettings,
} from "@northstar/core";

/** Lightweight placeholder — device integrations feature removed. */
type DeviceIntegrations = Record<string, unknown>;
import { query } from "../db/pool";
import { requireUserId } from "./_context";
import { parseJson } from "./_json";

interface UserRow {
  user_id: string;
  name: string;
  goal_raw: string;
  onboarding_complete: boolean;
  settings: Record<string, unknown> | string | null;
  weekly_availability: unknown[] | string | null;
  device_integrations: Record<string, unknown> | string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function parseJsonArray(v: unknown): unknown[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToProfile(r: UserRow): UserProfile {
  const extras = parseJson(r.payload);
  const settings = parseJson(r.settings) as unknown as UserSettings;
  const weeklyAvailability = parseJsonArray(r.weekly_availability) as TimeBlock[];
  return {
    id: r.user_id,
    name: r.name,
    goalRaw: r.goal_raw,
    onboardingComplete: r.onboarding_complete,
    weeklyAvailability,
    createdAt: r.created_at,
    settings,
    age: extras.age as number | undefined,
    currentRole: extras.currentRole as string | undefined,
    education: extras.education as string | undefined,
    location: extras.location as string | undefined,
    timezone: extras.timezone as string | undefined,
    context: extras.context as string | undefined,
    timeAvailable: extras.timeAvailable as string | undefined,
    constraints: extras.constraints as string | undefined,
    moodBaseline: extras.moodBaseline as string | undefined,
  };
}

function profileToPayload(p: UserProfile): Record<string, unknown> {
  return {
    age: p.age,
    currentRole: p.currentRole,
    education: p.education,
    location: p.location,
    timezone: p.timezone,
    context: p.context,
    timeAvailable: p.timeAvailable,
    constraints: p.constraints,
    moodBaseline: p.moodBaseline,
  };
}

export async function get(): Promise<UserProfile | null> {
  const userId = requireUserId();
  const rows = await query<UserRow>(
    `select * from users where user_id = $1`,
    [userId],
  );
  return rows.length > 0 ? rowToProfile(rows[0]) : null;
}

export async function getDeviceIntegrations(): Promise<DeviceIntegrations | null> {
  const userId = requireUserId();
  const rows = await query<{ device_integrations: UserRow["device_integrations"] }>(
    `select device_integrations from users where user_id = $1`,
    [userId],
  );
  if (rows.length === 0) return null;
  const parsed = parseJson(rows[0].device_integrations);
  return Object.keys(parsed).length > 0
    ? (parsed as unknown as DeviceIntegrations)
    : null;
}

/** Full upsert — replaces every field. Use for onboarding finalize and
 *  the rare "write the whole profile" path. Partial updates go through
 *  `updateSettings`, `completeOnboarding`, `updateDeviceIntegrations`. */
export async function upsert(profile: UserProfile): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into users (
       user_id, name, goal_raw, onboarding_complete, settings,
       weekly_availability, device_integrations, payload, updated_at
     ) values (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, now()
     )
     on conflict (user_id) do update set
       name = excluded.name,
       goal_raw = excluded.goal_raw,
       onboarding_complete = excluded.onboarding_complete,
       settings = excluded.settings,
       weekly_availability = excluded.weekly_availability,
       device_integrations = excluded.device_integrations,
       payload = excluded.payload,
       updated_at = now()`,
    [
      userId,
      profile.name ?? "",
      profile.goalRaw ?? "",
      profile.onboardingComplete ?? false,
      JSON.stringify(profile.settings ?? {}),
      JSON.stringify(profile.weeklyAvailability ?? []),
      JSON.stringify({}),
      JSON.stringify(profileToPayload(profile)),
    ],
  );
}

/** Atomic settings merge at the DB layer — no read-modify-write.
 *  Uses `settings || $2::jsonb` so the passed object's keys overwrite
 *  matching keys in the existing settings blob and leave the rest alone. */
export async function updateSettings(
  patch: Partial<UserSettings>,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into users (user_id, settings, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id) do update set
       settings = users.settings || $2::jsonb,
       updated_at = now()`,
    [userId, JSON.stringify(patch)],
  );
}

export async function updateWeeklyAvailability(
  blocks: TimeBlock[],
): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into users (user_id, weekly_availability, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id) do update set
       weekly_availability = excluded.weekly_availability,
       updated_at = now()`,
    [userId, JSON.stringify(blocks)],
  );
}

export async function updateDeviceIntegrations(
  integrations: DeviceIntegrations,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into users (user_id, device_integrations, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (user_id) do update set
       device_integrations = excluded.device_integrations,
       updated_at = now()`,
    [userId, JSON.stringify(integrations)],
  );
}

/** Merge a partial object into the payload jsonb column — no read-modify-write. */
export async function updatePayload(
  patch: Record<string, unknown>,
): Promise<void> {
  const userId = requireUserId();
  await query(
    `update users set payload = coalesce(payload, '{}'::jsonb) || $2::jsonb, updated_at = now()
     where user_id = $1`,
    [userId, JSON.stringify(patch)],
  );
}

export async function completeOnboarding(
  name: string,
  goalRaw: string,
  weeklyAvailability: TimeBlock[],
): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into users (
       user_id, name, goal_raw, onboarding_complete, weekly_availability,
       updated_at
     ) values ($1, $2, $3, true, $4::jsonb, now())
     on conflict (user_id) do update set
       name = excluded.name,
       goal_raw = excluded.goal_raw,
       onboarding_complete = true,
       weekly_availability = excluded.weekly_availability,
       updated_at = now()`,
    [userId, name, goalRaw, JSON.stringify(weeklyAvailability)],
  );
}
