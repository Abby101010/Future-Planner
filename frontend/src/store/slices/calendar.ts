/* NorthStar — calendar slice (in-app events + device integrations) */

import type { StateCreator } from "zustand";
import type { CalendarEvent, DeviceIntegrations } from "../../types";
import type { StoreApi } from "../useStore";

export const DEFAULT_INTEGRATIONS: DeviceIntegrations = {
  calendar: { enabled: false, selectedCalendars: [] },
  reminders: { enabled: false, selectedLists: [] },
};

export interface CalendarSlice {
  calendarEvents: CalendarEvent[];
  addCalendarEvent: (e: CalendarEvent) => void;
  updateCalendarEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  removeCalendarEvent: (id: string) => void;
  setCalendarEvents: (events: CalendarEvent[]) => void;

  deviceIntegrations: DeviceIntegrations;
  setDeviceIntegrations: (d: DeviceIntegrations) => void;
  updateIntegration: (
    key: keyof DeviceIntegrations,
    updates: Partial<DeviceIntegrations[keyof DeviceIntegrations]>,
  ) => void;
}

export const createCalendarSlice: StateCreator<
  StoreApi,
  [],
  [],
  CalendarSlice
> = (set, get) => ({
  calendarEvents: [],
  addCalendarEvent: (e) => {
    set((s) => ({ calendarEvents: [...s.calendarEvents, e] }));
    get().saveToDisk();
  },
  updateCalendarEvent: (id, updates) => {
    set((s) => ({
      calendarEvents: s.calendarEvents.map((e) =>
        e.id === id ? { ...e, ...updates } : e,
      ),
    }));
    get().saveToDisk();
  },
  removeCalendarEvent: (id) => {
    set((s) => ({
      calendarEvents: s.calendarEvents.filter((e) => e.id !== id),
    }));
    get().saveToDisk();
  },
  setCalendarEvents: (events) => {
    set({ calendarEvents: events });
    get().saveToDisk();
  },

  deviceIntegrations: DEFAULT_INTEGRATIONS,
  setDeviceIntegrations: (d) => {
    set({ deviceIntegrations: d });
    get().saveToDisk();
  },
  updateIntegration: (key, updates) => {
    set((s) => ({
      deviceIntegrations: {
        ...s.deviceIntegrations,
        [key]: { ...s.deviceIntegrations[key], ...updates },
      },
    }));
    get().saveToDisk();
  },
});
