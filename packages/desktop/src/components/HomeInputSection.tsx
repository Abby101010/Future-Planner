import { RefObject } from "react";
import {
  Send,
  Loader2,
  Plus,
  MessageSquare,
  X,
  FileText,
  Image as ImageIcon,
} from "lucide-react";

export interface HomeAttachment {
  id: string;
  file: File;
  name: string;
  type: "image" | "pdf";
  previewUrl?: string;
  base64: string;
  mediaType: string;
}

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  isLoading: boolean;
  inputRef: RefObject<HTMLTextAreaElement>;
  fileInputRef: RefObject<HTMLInputElement>;
  attachments: HomeAttachment[];
  onRemoveAttachment: (id: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleChatList: () => void;
  onSend: () => void;
}

export default function HomeInputSection({
  input,
  onInputChange,
  isLoading,
  inputRef,
  fileInputRef,
  attachments,
  onRemoveAttachment,
  onFileSelect,
  onToggleChatList,
  onSend,
}: Props) {
  return (
    <div className="home-input-section">
      <div className="home-input-row">
        <button
          className="btn btn-ghost home-chat-list-btn"
          onClick={onToggleChatList}
          title="Chat history"
        >
          <MessageSquare size={16} />
        </button>
        <textarea
          ref={inputRef}
          className="home-input"
          placeholder="Ask anything, add a task, or check your progress..."
          value={input}
          rows={1}
          onChange={(e) => {
            onInputChange(e.target.value);
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = Math.min(el.scrollHeight, 150) + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && input.trim()) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={isLoading}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="home-file-input-hidden"
          accept="image/*,.pdf"
          multiple
          onChange={onFileSelect}
        />
        <button
          className="btn btn-ghost home-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach image or PDF"
        >
          <Plus size={16} />
        </button>
        <button
          className="btn btn-primary home-send-btn"
          onClick={onSend}
          disabled={isLoading || (!input.trim() && attachments.length === 0)}
        >
          {isLoading ? (
            <Loader2 size={16} className="spin" />
          ) : (
            <Send size={16} />
          )}
        </button>
      </div>
      {attachments.length > 0 && (
        <div className="home-attachments">
          {attachments.map((att) => (
            <div key={att.id} className="home-attachment-chip">
              {att.type === "image" ? (
                att.previewUrl ? (
                  <img
                    src={att.previewUrl}
                    alt={att.name}
                    className="home-attachment-thumb"
                  />
                ) : (
                  <ImageIcon size={14} />
                )
              ) : (
                <FileText size={14} />
              )}
              <span className="home-attachment-name">{att.name}</span>
              <button
                className="home-attachment-remove"
                onClick={() => onRemoveAttachment(att.id)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
