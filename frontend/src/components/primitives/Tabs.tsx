/* Tabs — horizontal tab bar with optional icon + badge per tab. */

import Icon, { type IconName } from "./Icon";
import Pill from "./Pill";

export interface TabSpec<T extends string = string> {
  id: T;
  label: string;
  icon?: IconName;
  /** Optional small badge (e.g. a count) rendered after the label. */
  badge?: string | number;
}

export interface TabsProps<T extends string> {
  value: T;
  onChange: (id: T) => void;
  tabs: TabSpec<T>[];
}

export default function Tabs<T extends string>({ value, onChange, tabs }: TabsProps<T>) {
  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        borderBottom: "1px solid var(--border)",
        padding: "0 32px",
        background: "var(--bg)",
      }}
    >
      {tabs.map((t) => {
        const active = value === t.id;
        return (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            data-active={active ? "true" : "false"}
            onClick={() => onChange(t.id)}
            style={{
              padding: "12px 18px",
              border: 0,
              background: "transparent",
              cursor: "pointer",
              fontSize: "var(--t-md)",
              fontWeight: 500,
              color: active ? "var(--fg)" : "var(--fg-mute)",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {t.icon && <Icon name={t.icon} size={13} />}
            <span>{t.label}</span>
            {t.badge !== undefined && <Pill mono>{t.badge}</Pill>}
          </button>
        );
      })}
    </div>
  );
}
