/* ChatFab — fixed circular button that toggles FloatingChat open/closed. */

import useStore from "../../store/useStore";
import Icon from "../primitives/Icon";

export default function ChatFab() {
  const isOpen = useStore((s) => s.isChatOpen);
  const toggle = useStore((s) => s.toggleChat);
  return (
    <button
      data-testid="chat-fab"
      onClick={toggle}
      title="Chat with Starward"
      style={{
        position: "fixed",
        right: 20,
        bottom: 20,
        width: 52,
        height: 52,
        borderRadius: "50%",
        border: 0,
        cursor: "pointer",
        background: isOpen ? "var(--navy)" : "var(--navy-deep)",
        color: "var(--white)",
        boxShadow: "var(--shadow-3)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name={isOpen ? "x" : "chat"} size={20} />
    </button>
  );
}
