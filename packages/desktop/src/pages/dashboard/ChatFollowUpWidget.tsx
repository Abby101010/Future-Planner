import { useState } from "react";
import type { ChatWidget } from "@northstar/core";
import "./ChatFollowUpWidget.css";

interface Props {
  widget: ChatWidget;
  onSelect: (value: string) => void;
}

export default function ChatFollowUpWidget({ widget, onSelect }: Props) {
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  if (widget.type === "choices") {
    return (
      <div className="chat-widget chat-widget-choices">
        {widget.options.map((opt) => (
          <button
            key={opt.value}
            className={`chat-widget-pill${selectedValue === opt.value ? " chat-widget-pill--selected" : ""}`}
            disabled={selectedValue !== null}
            onClick={() => {
              setSelectedValue(opt.value);
              onSelect(opt.label);
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  if (widget.type === "date-picker") {
    return (
      <div className="chat-widget chat-widget-picker">
        <input
          type="date"
          className="chat-widget-input"
          disabled={selectedValue !== null}
          onChange={(e) => {
            if (e.target.value) {
              setSelectedValue(e.target.value);
              onSelect(e.target.value);
            }
          }}
        />
      </div>
    );
  }

  if (widget.type === "time-picker") {
    return (
      <div className="chat-widget chat-widget-picker">
        <input
          type="time"
          className="chat-widget-input"
          disabled={selectedValue !== null}
          onChange={(e) => {
            if (e.target.value) {
              setSelectedValue(e.target.value);
              onSelect(e.target.value);
            }
          }}
        />
      </div>
    );
  }

  if (widget.type === "datetime-picker") {
    return (
      <div className="chat-widget chat-widget-picker chat-widget-datetime">
        <input
          type="date"
          className="chat-widget-input"
          onChange={(e) => {
            if (e.target.value) {
              setSelectedValue(e.target.value);
              onSelect(e.target.value);
            }
          }}
        />
        <input
          type="time"
          className="chat-widget-input"
          onChange={(e) => {
            if (e.target.value) {
              onSelect(e.target.value);
            }
          }}
        />
      </div>
    );
  }

  return null;
}
