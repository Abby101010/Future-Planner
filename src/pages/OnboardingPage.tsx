/* ──────────────────────────────────────────────────────────
   NorthStar — Onboarding page (conversational goal coach)
   ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Star, ArrowRight, Key } from "lucide-react";
import useStore from "../store/useStore";
import { useT } from "../i18n";
import { sendOnboardingMessage, generateGoalBreakdown } from "../services/ai";
import type { ConversationMessage, ClarifiedGoal } from "../types";
import "./OnboardingPage.css";

export default function OnboardingPage() {
  const {
    conversations,
    addMessage,
    setUser,
    setGoalBreakdown,
    setView,
    user,
    calendarEvents,
    deviceIntegrations,
    isLoading,
    setLoading,
    error,
    setError,
  } = useStore();

  const [input, setInput] = useState("");
  const [step, setStep] = useState<"api-key" | "goal" | "chat" | "confirm" | "generating">(
    user?.settings.apiKey ? "goal" : "api-key"
  );
  const [apiKey, setApiKey] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversations]);

  // Check if we already have an API key from env or settings
  useEffect(() => {
    if (step === "api-key") {
      // Try to see if env key works by checking stored user
      if (user?.settings.apiKey) {
        setStep("goal");
      }
    }
  }, [step, user]);

  const handleApiKeySubmit = () => {
    if (!apiKey.trim()) return;
    const newUser = user || {
      id: `user-${Date.now()}`,
      name: "",
      goalRaw: "",
      createdAt: new Date().toISOString(),
      settings: {
        enableMoodLogging: false,
        enableNewsFeed: false,
        theme: "dark" as const,
        language: "en" as const,
      },
    };
    setUser({ ...newUser, settings: { ...newUser.settings, apiKey: apiKey.trim() } });
    setStep("goal");
  };

  const handleGoalSubmit = async () => {
    if (!input.trim()) return;
    const goalText = input.trim();
    setInput("");

    // Save initial user with raw goal
    const newUser = user || {
      id: `user-${Date.now()}`,
      name: "",
      goalRaw: goalText,
      createdAt: new Date().toISOString(),
      settings: {
        enableMoodLogging: false,
        enableNewsFeed: false,
        theme: "dark" as const,
        language: "en" as const,
        apiKey: apiKey || undefined,
      },
    };
    if (!user) setUser({ ...newUser, goalRaw: goalText });

    // Add user message
    const userMsg: ConversationMessage = {
      role: "user",
      content: goalText,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg);
    setStep("chat");
    setLoading(true);
    setError(null);

    try {
      const reply = await sendOnboardingMessage([], goalText);
      const assistantMsg: ConversationMessage = {
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      };
      addMessage(assistantMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to AI");
    } finally {
      setLoading(false);
    }
  };

  const handleChatSend = async () => {
    if (!input.trim() || isLoading) return;
    const text = input.trim();
    setInput("");

    const userMsg: ConversationMessage = {
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
    };
    addMessage(userMsg);
    setLoading(true);
    setError(null);

    try {
      const allMessages = [...conversations, userMsg];
      const reply = await sendOnboardingMessage(allMessages, text);
      const assistantMsg: ConversationMessage = {
        role: "assistant",
        content: reply,
        timestamp: new Date().toISOString(),
      };
      addMessage(assistantMsg);

      // Check if AI has provided a structured summary (ready for confirmation)
      if (
        reply.includes("Goal:") &&
        reply.includes("Target outcome:") &&
        reply.includes("Does this feel right")
      ) {
        setStep("confirm");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to AI");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAndGenerate = async () => {
    setStep("generating");
    setLoading(true);
    setError(null);

    try {
      // Extract goal info from conversation
      const lastAssistant = [...conversations]
        .reverse()
        .find((m) => m.role === "assistant");
      const goalText = lastAssistant?.content || "";

      // Parse the structured summary from the AI's response
      const goal: ClarifiedGoal = {
        goal: extractField(goalText, "Goal"),
        startingPoint: extractField(goalText, "Starting point"),
        targetOutcome: extractField(goalText, "Target outcome"),
        timeline: extractField(goalText, "Timeline"),
        timeBudget: extractField(goalText, "Time budget"),
        constraints: extractField(goalText, "Constraints"),
        motivation: extractField(goalText, "Motivation"),
      };

      const breakdown = await generateGoalBreakdown(goal, undefined, undefined, calendarEvents, deviceIntegrations);
      setGoalBreakdown(breakdown);
      setView("goal-breakdown");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate goal plan");
      setStep("confirm");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (step === "goal") handleGoalSubmit();
      else if (step === "chat" || step === "confirm") handleChatSend();
    }
  };

  // ── Render ──────────────────────────────────────────

  return (
    <div className="onboarding">
      <div className="onboarding-container">
        {/* Header */}
        <div className="onboarding-header animate-fade-in">
          <Star size={24} className="onboarding-star" />
          <h2>{t.onboarding.title}</h2>
          <p>
            {step === "api-key"
              ? t.onboarding.apiKeyStep
              : step === "goal"
                ? t.onboarding.goalStep
                : step === "generating"
                  ? t.onboarding.generatingStep
                  : t.onboarding.chatStep}
          </p>
        </div>

        {/* API Key Step */}
        {step === "api-key" && (
          <div className="onboarding-apikey animate-slide-up">
            <div className="apikey-card card">
              <Key size={24} className="apikey-icon" />
              <h3>{t.onboarding.apiKeyTitle}</h3>
              <p>
                {t.onboarding.apiKeyDesc}
              </p>
              <div className="apikey-input-row">
                <input
                  type="password"
                  className="input"
                  placeholder={t.onboarding.apiKeyPlaceholder}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleApiKeySubmit();
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleApiKeySubmit}
                  disabled={!apiKey.trim()}
                >
                  {t.common.continue}
                  <ArrowRight size={16} />
                </button>
              </div>
              <p className="apikey-hint">
                {t.onboarding.apiKeyHint}{" "}
                <a
                  href="https://console.anthropic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  console.anthropic.com
                </a>
              </p>
            </div>
          </div>
        )}

        {/* Conversation */}
        {step !== "api-key" && (
          <>
            <div className="onboarding-messages">
              {conversations.map((msg, i) => (
                <div
                  key={i}
                  className={`message ${msg.role} animate-fade-in`}
                  style={{ animationDelay: `${i * 0.05}s` }}
                >
                  {msg.role === "assistant" && (
                    <div className="message-avatar">
                      <Star size={14} />
                    </div>
                  )}
                  <div className="message-bubble">
                    <p className="message-text">{msg.content}</p>
                  </div>
                </div>
              ))}

              {isLoading && step !== "generating" && (
                <div className="message assistant animate-fade-in">
                  <div className="message-avatar">
                    <Star size={14} />
                  </div>
                  <div className="message-bubble typing">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Generating state */}
            {step === "generating" && (
              <div className="generating animate-slide-up">
                <Loader2 size={32} className="generating-spinner" />
                <p>{t.onboarding.generatingAnalyzing}</p>
                <p className="generating-sub">
                  {t.onboarding.generatingTime}
                </p>
              </div>
            )}

            {/* Confirm button */}
            {step === "confirm" && !isLoading && (
              <div className="confirm-bar animate-slide-up">
                <button
                  className="btn btn-primary btn-lg"
                  onClick={handleConfirmAndGenerate}
                >
                  {t.onboarding.confirmButton}
                  <ArrowRight size={18} />
                </button>
                <span className="confirm-hint">
                  {t.onboarding.confirmHint}
                </span>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="onboarding-error animate-fade-in">
                <p>{error}</p>
              </div>
            )}

            {/* Input */}
            {step !== "generating" && (
              <div className="onboarding-input-bar">
                <div className="onboarding-input-wrap">
                  <textarea
                    className="input onboarding-input"
                    placeholder={
                      step === "goal"
                        ? t.onboarding.goalPlaceholder
                        : t.onboarding.chatPlaceholder
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    disabled={isLoading}
                  />
                  <button
                    className="btn btn-primary btn-icon onboarding-send"
                    onClick={step === "goal" ? handleGoalSubmit : handleChatSend}
                    disabled={!input.trim() || isLoading}
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function extractField(text: string, field: string): string {
  const regex = new RegExp(`${field}:\\s*(.+?)(?:\\n|$)`, "i");
  const match = text.match(regex);
  return match ? match[1].trim() : "";
}
