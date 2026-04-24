/* Starward server — users repository
 *
 * Wraps the `users` table (migration 0004). Exactly one row per user
 * (PK is user_id alone). Replaces the legacy `app_store.user` JSON blob.
 *
 * Stable identity + onboarding fields are columns; profile extras
 * (age, currentRole, education, location, etc.) round-trip through the
 * `payload` jsonb column. Settings gets its own typed jsonb column.
 *
 * The `weekly_availability` DB column is preserved but no longer read
 * or written (time map feature removed). Safe to drop in a future
 * migration once legacy deployments have updated.
 *
 * Partial updates use COALESCE on the parameter so callers can pass
 * null for fields they don't want to touch — this is what makes
 * `cmdUpdateSettings` atomic (no read-merge-write).
 */

import type {
  UserProfile,
  UserSettings,
} from "@starward/core";

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
  device_integrations: Record<string, unknown> | string | null;
  payload: Record<string, unknown> | string | null;
  created_at: string;
  updated_at: string;
}

function rowToProfile(r: UserRow): UserProfile {
  const extras = parseJson(r.payload);
  const settings = parseJson(r.settings) as unknown as UserSettings;
  return {
    id: r.user_id,
    name: r.name,
    goalRaw: r.goal_raw,
    onboardingComplete: r.onboarding_complete,
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
       device_integrations, payload, updated_at
     ) values (
       $1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, now()
     )
     on conflict (user_id) do update set
       name = excluded.name,
       goal_raw = excluded.goal_raw,
       onboarding_complete = excluded.onboarding_complete,
       settings = excluded.settings,
       device_integrations = excluded.device_integrations,
       payload = excluded.payload,
       updated_at = now()`,
    [
      userId,
      profile.name ?? "",
      profile.goalRaw ?? "",
      profile.onboardingComplete ?? false,
      JSON.stringify(profile.settings ?? {}),
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
): Promise<void> {
  const userId = requireUserId();
  await query(
    `insert into users (
       user_id, name, goal_raw, onboarding_complete, updated_at
     ) values ($1, $2, $3, true, now())
     on conflict (user_id) do update set
       name = excluded.name,
       goal_raw = excluded.goal_raw,
       onboarding_complete = true,
       updated_at = now()`,
    [userId, name, goalRaw],
  );
}
