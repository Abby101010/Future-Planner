import { Settings2, Loader2, RefreshCw, Download } from "lucide-react";
import type { DeviceIntegrations } from "@northstar/core";

interface Props {
  deviceIntegrations: DeviceIntegrations;
  availableDeviceCalendars: string[];
  loadingDeviceCals: boolean;
  syncing: boolean;
  syncMessage: string;
  onEnable: (enabled: boolean) => void;
  onList: () => void;
  onToggle: (name: string) => void;
  onSyncNow: () => void;
}

export default function DeviceCalendarPanel({
  deviceIntegrations,
  availableDeviceCalendars,
  loadingDeviceCals,
  syncing,
  syncMessage,
  onEnable,
  onList,
  onToggle,
  onSyncNow,
}: Props) {
  return (
    <div className="cal-integrations card animate-slide-up">
      <div className="cal-int-header">
        <Settings2 size={18} />
        <h3>Device Calendar Sync</h3>
        <span className="cal-int-badge">Optional</span>
      </div>
      <p className="cal-int-desc">
        Optionally import events from your device's calendar apps. Choose which
        calendars the AI should pay attention to. Your data stays on this
        device.
      </p>

      <div className="cal-int-toggle">
        <label className="toggle-row-inline">
          <span>Enable macOS Calendar sync</span>
          <label className="toggle">
            <input
              type="checkbox"
              checked={deviceIntegrations.calendar.enabled}
              onChange={(e) => onEnable(e.target.checked)}
            />
            <span className="toggle-slider" />
          </label>
        </label>
      </div>

      {deviceIntegrations.calendar.enabled && (
        <div className="cal-int-calendars animate-fade-in">
          <div className="cal-int-calendars-header">
            <strong>Select calendars to import:</strong>
            {loadingDeviceCals ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <button className="btn btn-ghost btn-xs" onClick={onList}>
                <RefreshCw size={12} />
                Refresh
              </button>
            )}
          </div>

          {availableDeviceCalendars.length === 0 ? (
            <p className="cal-int-empty">
              {loadingDeviceCals
                ? "Loading calendars..."
                : "No calendars found. Click Refresh to scan."}
            </p>
          ) : (
            <div className="cal-int-list">
              {availableDeviceCalendars.map((name) => (
                <label key={name} className="cal-int-item">
                  <input
                    type="checkbox"
                    checked={deviceIntegrations.calendar.selectedCalendars.includes(
                      name,
                    )}
                    onChange={() => onToggle(name)}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="cal-int-sync-row">
            <button
              className="btn btn-secondary btn-sm"
              onClick={onSyncNow}
              disabled={
                syncing ||
                deviceIntegrations.calendar.selectedCalendars.length === 0
              }
            >
              {syncing ? (
                <>
                  <Loader2 size={14} className="spin" />
                  Syncing...
                </>
              ) : (
                <>
                  <Download size={14} />
                  Sync Now
                </>
              )}
            </button>
            {deviceIntegrations.calendar.lastSynced && (
              <span className="cal-int-last-sync">
                Last synced:{" "}
                {new Date(
                  deviceIntegrations.calendar.lastSynced,
                ).toLocaleString()}
              </span>
            )}
            {syncMessage && (
              <span className="cal-int-sync-msg">{syncMessage}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
