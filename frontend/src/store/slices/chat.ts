/* NorthStar — chat slice (home chat messages, sessions) */

import type { StateCreator } from "zustand";
import type { ChatSession, HomeChatMessage } from "../../types";
import { chatRepo, memoryRepo } from "../../repositories";
import type { StoreApi } from "../useStore";

export interface ChatSlice {
  chatSessions: ChatSession[];
  activeChatId: string | null;
  homeChatMessages: HomeChatMessage[];
  addHomeChatMessage: (msg: HomeChatMessage) => void;
  clearHomeChat: () => void;
  startNewChat: () => void;
  switchChat: (sessionId: string) => void;
  deleteChat: (sessionId: string) => void;
}

export const createChatSlice: StateCreator<StoreApi, [], [], ChatSlice> = (
  set,
  get,
) => ({
  chatSessions: [],
  activeChatId: null,
  homeChatMessages: [],
  addHomeChatMessage: (msg) => {
    const messages = [...get().homeChatMessages, msg];
    const activeChatId = get().activeChatId;

    if (!activeChatId) {
      const title = msg.role === "user" ? msg.content.slice(0, 50) : "New chat";
      const newSession: ChatSession = {
        id: crypto.randomUUID(),
        title,
        messages,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      set({
        homeChatMessages: messages,
        chatSessions: [newSession, ...get().chatSessions],
        activeChatId: newSession.id,
      });
      chatRepo.saveSession(newSession).catch(() => {});
    } else {
      const updatedAt = new Date().toISOString();
      const updatedSessions = get().chatSessions.map((s) =>
        s.id === activeChatId ? { ...s, messages, updatedAt } : s,
      );
      set({
        homeChatMessages: messages,
        chatSessions: updatedSessions,
      });
      const session = updatedSessions.find((s) => s.id === activeChatId);
      if (session) {
        chatRepo.saveSession(session).catch(() => {});
      }
    }

    if (msg.role === "assistant" && messages.length > 1) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      if (lastUserMsg) {
        memoryRepo
          .recordChatInsight({
            userMessage: lastUserMsg.content,
            aiReply: msg.content,
          })
          .catch(() => {});
      }
    }
  },
  clearHomeChat: () => {
    set({ homeChatMessages: [], activeChatId: null });
  },
  startNewChat: () => {
    set({ homeChatMessages: [], activeChatId: null });
  },
  switchChat: (sessionId) => {
    const session = get().chatSessions.find((s) => s.id === sessionId);
    if (session) {
      set({ homeChatMessages: session.messages, activeChatId: sessionId });
    }
  },
  deleteChat: (sessionId) => {
    const isActive = get().activeChatId === sessionId;
    set({
      chatSessions: get().chatSessions.filter((s) => s.id !== sessionId),
      ...(isActive ? { homeChatMessages: [], activeChatId: null } : {}),
    });
    chatRepo.deleteSession(sessionId).catch(() => {});
  },
});
