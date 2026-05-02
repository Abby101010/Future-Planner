/* useDayRollover — unit tests for the pure helper.
 *
 * The hook itself touches DOM listeners and wsClient, which require
 * jsdom + mocking — out of scope for this PR. The decision logic that
 * actually drives the bug fix lives in the pure `shouldRefresh` helper,
 * which is fully covered here.
 */

import { describe, expect, it } from "vitest";
import { localDateString, shouldRefresh } from "./dayRolloverDecision";

describe("localDateString", () => {
  it("returns YYYY-MM-DD with zero-padded fields", () => {
    const d = new Date(2025, 0, 5); // Jan 5, 2025 — month index 0
    expect(localDateString(d)).toBe("2025-01-05");
  });
  it("uses local time, not UTC", () => {
    // 23:30 local on Apr 30 — even when UTC has rolled to May 1, the
    // helper must report the local date the user actually sees.
    const d = new Date(2026, 3, 30, 23, 30, 0);
    expect(localDateString(d)).toBe("2026-04-30");
  });
});

describe("shouldRefresh", () => {
  const base = {
    lastDate: "2026-04-30",
    lastActivity: 1_000_000,
    currentDate: "2026-04-30",
    now: 1_000_500,
    thresholdMs: 60_000,
  };

  it("returns false when nothing changed and we're inside the activity window", () => {
    expect(shouldRefresh(base)).toBe(false);
  });

  it("returns true when the local date flips", () => {
    expect(shouldRefresh({ ...base, currentDate: "2026-05-01" })).toBe(true);
  });

  it("returns true after the activity threshold elapses, even on the same date", () => {
    expect(
      shouldRefresh({ ...base, now: base.lastActivity + 60_001 }),
    ).toBe(true);
  });

  it("returns false at exactly the threshold (strict greater-than)", () => {
    expect(
      shouldRefresh({ ...base, now: base.lastActivity + 60_000 }),
    ).toBe(false);
  });

  it("date change beats threshold check (both refetch reasons short-circuit)", () => {
    expect(
      shouldRefresh({
        ...base,
        currentDate: "2026-05-01",
        now: base.lastActivity + 5,
      }),
    ).toBe(true);
  });
});
