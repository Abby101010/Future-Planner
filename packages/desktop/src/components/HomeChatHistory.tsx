import { forwardRef, useMemo } from "react";
import { Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { HomeChatMessage } from "@northstar/core";

/** Max number of user↔assistant exchanges to show (× 2 = messages). */
const MAX_VISIBLE_EXCHANGES = 4;

interface Props {
  messages: HomeChatMessage[];
  isLoading: boolean;
}

const HomeChatHistory = forwardRef<HTMLDivElement, Props>(
  ({ messages, isLoading }, chatEndRef) => {
    // Only show the last N exchanges so the home page stays tidy
    const visibleMessages = useMemo(
      () => messages.slice(-(MAX_VISIBLE_EXCHANGES * 2)),
      [messages],
    );

    if (visibleMessages.length === 0 && !isLoading) return null;
    return (
      <div className="home-chat-history">
        {visibleMessages.map((msg) => (
          <div key={msg.id} className={`home-chat-msg home-chat-${msg.role}`}>
            <div className="home-chat-bubble">
              {msg.role === "assistant" ? (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="home-chat-msg home-chat-assistant">
            <div className="home-chat-bubble home-chat-loading">
              <Loader2 size={14} className="spin" />
              <span>Thinking...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
    );
  },
);

HomeChatHistory.displayName = "HomeChatHistory";
export default HomeChatHistory;
