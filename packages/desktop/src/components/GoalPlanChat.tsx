import { RefObject } from "react";
import {
  Send,
  Loader2,
  Sparkles,
  Edit3,
  MessageSquare,
} from "lucide-react";
import RichTextToolbar from "./RichTextToolbar";
import type { GoalPlanMessage } from "@northstar/core";
import { getDateLocale, type Language } from "../i18n";

/**
 * Sanitize an assistant message that may have been persisted as raw JSON
 * (a bug from earlier versions).  Extracts the "reply" field if the
 * content looks like a JSON envelope.
 */
function sanitizeContent(msg: GoalPlanMessage): string {
  const text = msg.content;
  if (msg.role !== "assistant") return text;
  // Quick check — does it look like a JSON object with a reply field?
  if (!text.trimStart().startsWith("{") || !text.includes('"reply"'))
    return text;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.reply === "string") return parsed.reply;
  } catch {
    // Try regex extraction as fallback
    const m = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) {
      return m[1]
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\");
    }
  }
  return text;
}

interface Props {
  planChat: GoalPlanMessage[];
  isLoading: boolean;
  isStreaming?: boolean;
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLTextAreaElement>;
  endRef: RefObject<HTMLDivElement>;
  onInsertText: (text: string) => void;
  lang: Language;
  t: ReturnType<typeof import("../i18n").useT>;
}

export default function GoalPlanChat({
  planChat,
  isLoading,
  isStreaming,
  chatInput,
  onChatInputChange,
  onSend,
  inputRef,
  endRef,
  onInsertText,
  lang,
  t,
}: Props) {
  return (
    <div className="gp-chat gp-chat-prominent animate-slide-up">
      <div className="gp-chat-header-static">
        <MessageSquare size={16} />
        <h3>{t.goalPlan.planningChat}</h3>
        {planChat.length > 0 && (
          <span className="gp-chat-count">{planChat.length}</span>
        )}
      </div>

      {planChat.length > 0 && (
        <div className="gp-chat-messages">
          {planChat.map((msg) => (
            <div key={msg.id} className={`gp-chat-msg ${msg.role}`}>
              <div className="gp-chat-msg-avatar">
                {msg.role === "assistant" ? (
                  <Sparkles size={14} />
                ) : (
                  <Edit3 size={14} />
                )}
              </div>
              <div className="gp-chat-msg-content">
                <p>{sanitizeContent(msg)}</p>
                <span className="gp-chat-msg-time">
                  {new Date(msg.timestamp).toLocaleTimeString(
                    getDateLocale(lang),
                    { hour: "numeric", minute: "2-digit" },
                  )}
                </span>
              </div>
            </div>
          ))}
          {isLoading && !isStreaming && (
            <div className="gp-chat-msg assistant">
              <div className="gp-chat-msg-avatar">
                <Loader2 size={14} className="spin" />
              </div>
              <div className="gp-chat-msg-content">
                <p className="gp-typing">{t.goalPlan.thinking}</p>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}

      {planChat.length === 0 && (
        <div className="gp-chat-empty">
          <p>
            Ask the AI to adjust your plan, change timelines, add tasks, or
            discuss strategy.
          </p>
        </div>
      )}

      <div className="gp-chat-input-area">
        <RichTextToolbar onInsertText={onInsertText} compact />
        <div className="gp-chat-input-row">
          <textarea
            ref={inputRef}
            className="input gp-chat-input"
            placeholder={t.goalPlan.chatPlaceholder}
            value={chatInput}
            rows={1}
            onChange={(e) => {
              onChatInputChange(e.target.value);
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 150) + "px";
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSend();
              }
            }}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary btn-sm"
            onClick={onSend}
            disabled={isLoading || !chatInput.trim()}
          >
            {isLoading ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
