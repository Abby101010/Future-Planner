import { useEffect, useRef } from "react";
import type { Reminder } from "@northstar/core";

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls today's reminders every 30 seconds and fires a native OS
 * notification when a reminder's time has passed.  Uses optional chaining
 * so it silently no-ops outside Electron.
 */
export function useReminderNotifications(reminders: Reminder[]): void {
  const notifiedRef = useRef(new Set<string>());

  useEffect(() => {
    const check = () => {
      const now = new Date();
      for (const r of reminders) {
        if (notifiedRef.current.has(r.id)) continue;
        if (new Date(r.reminderTime) <= now) {
          notifiedRef.current.add(r.id);
          window.electronNotifications?.show(
            r.title,
            r.description || "Reminder is due",
          );
        }
      }
    };

    // Run immediately on mount / when reminders change
    check();

    const id = setInterval(check, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [reminders]);
}

/**
 * Fires a one-time summary notification when there are overdue reminders.
 */
export function useOverdueNotification(overdueReminders: Reminder[]): void {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (overdueReminders.length === 0) return;
    firedRef.current = true;

    const count = overdueReminders.length;
    window.electronNotifications?.show(
      `${count} overdue reminder${count === 1 ? "" : "s"}`,
      overdueReminders
        .slice(0, 3)
        .map((r) => r.title)
        .join(", ") + (count > 3 ? "…" : ""),
    );
  }, [overdueReminders]);
}
