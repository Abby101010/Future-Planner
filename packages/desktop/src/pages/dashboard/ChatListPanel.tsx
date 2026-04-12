import { Plus, MessageSquare, Trash2 } from "lucide-react";
import type { ChatSession } from "@northstar/core";

interface Props {
  sessions: ChatSession[];
  activeChatId: string | null;
  onClose: () => void;
  onNewChat: () => void;
  onSwitchChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}

export default function ChatListPanel({
  sessions,
  activeChatId,
  onClose,
  onNewChat,
  onSwitchChat,
  onDeleteChat,
}: Props) {
  return (
    <div className="chat-list-panel">
      <div className="chat-list-header">
        <span className="chat-list-title">Chats</span>
        <button
          className="btn btn-ghost btn-sm"
          onClick={onClose}
          title="Close"
        >
          &times;
        </button>
      </div>
      <button className="chat-list-new-btn" onClick={onNewChat}>
        <Plus size={14} /> New chat
      </button>
      <div className="chat-list-items">
        {sessions.length === 0 && (
          <p className="chat-list-empty">No previous chats</p>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            className={`chat-list-item ${
              session.id === activeChatId ? "chat-list-item-active" : ""
            }`}
            onClick={() => onSwitchChat(session.id)}
          >
            <MessageSquare size={13} />
            <div className="chat-list-item-content">
              <span className="chat-list-item-title">{session.title}</span>
              <span className="chat-list-item-date">
                {new Date(session.updatedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <button
              className="chat-list-item-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteChat(session.id);
              }}
              title="Delete chat"
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
