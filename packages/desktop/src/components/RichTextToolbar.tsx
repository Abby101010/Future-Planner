/* ──────────────────────────────────────────────────────────
   NorthStar — Rich Text Toolbar
   Floating toolbar for: bold, highlight, text color,
   emoji, image insert, language toggle (CN/EN)
   ────────────────────────────────────────────────────────── */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bold,
  Highlighter,
  Palette,
  Smile,
  Image as ImageIcon,
  Languages,
  X,
} from "lucide-react";
import "./RichTextToolbar.css";

// Common emojis organized by category
const EMOJI_LIST = [
  "⭐", "🎯", "🔥", "💡", "✅", "📚", "💪", "🏃", "🎨", "🎵",
  "💻", "📝", "🌟", "🚀", "💎", "🧠", "❤️", "🌈", "☀️", "🌙",
  "🍎", "🥗", "💧", "🧘", "🏋️", "📖", "✍️", "🎓", "💰", "🏠",
  "🌱", "🌸", "🦋", "🐾", "🎶", "🖼️", "📷", "🗺️", "⏰", "📅",
];

// Text color palette — monochrome + a few subtle tones
const COLOR_PALETTE = [
  "#1a1a1a", "#444444", "#666666", "#999999",
  "#c0392b", "#e67e22", "#f1c40f", "#27ae60",
  "#2980b9", "#8e44ad", "#1abc9c", "#e91e63",
];

// Highlight color palette — soft backgrounds
const HIGHLIGHT_PALETTE = [
  "transparent",
  "#fff3cd", "#d4edda", "#cce5ff", "#f8d7da",
  "#e2d9f3", "#d1ecf1", "#fde2e4", "#e8f5e9",
];

interface RichTextToolbarProps {
  /** Called when user inserts text (emoji, formatted snippet) */
  onInsertText?: (text: string) => void;
  /** Called when user picks a text color */
  onColorChange?: (color: string) => void;
  /** Called when user picks a highlight color */
  onHighlightChange?: (color: string) => void;
  /** Called when user toggles bold */
  onBoldToggle?: () => void;
  /** Called when user selects an image file */
  onImageInsert?: (dataUrl: string, fileName: string) => void;
  /** Called when user toggles language input mode */
  onLanguageToggle?: () => void;
  /** Current language mode */
  language?: "en" | "zh";
  /** Is bold currently active? */
  isBold?: boolean;
  /** Current text color */
  currentColor?: string;
  /** Current highlight color */
  currentHighlight?: string;
  /** Compact mode (fewer buttons visible) */
  compact?: boolean;
}

export default function RichTextToolbar({
  onInsertText,
  onColorChange,
  onHighlightChange,
  onBoldToggle,
  onImageInsert,
  onLanguageToggle,
  language = "en",
  isBold = false,
  currentColor = "#1a1a1a",
  currentHighlight = "transparent",
  compact = false,
}: RichTextToolbarProps) {
  const [activePanel, setActivePanel] = useState<"emoji" | "color" | "highlight" | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setActivePanel(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const togglePanel = (panel: "emoji" | "color" | "highlight") => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  };

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !onImageInsert) return;
      if (!file.type.startsWith("image/")) return;

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onImageInsert(reader.result, file.name);
        }
      };
      reader.readAsDataURL(file);

      // Reset input so re-selecting same file triggers change
      e.target.value = "";
    },
    [onImageInsert]
  );

  return (
    <div className="rich-toolbar" ref={toolbarRef}>
      {/* Bold */}
      <button
        className={`rich-toolbar-btn ${isBold ? "active" : ""}`}
        onClick={onBoldToggle}
        title="Bold"
      >
        <Bold size={14} />
      </button>

      {/* Highlight */}
      <button
        className={`rich-toolbar-btn ${activePanel === "highlight" ? "active" : ""}`}
        onClick={() => togglePanel("highlight")}
        title="Highlight"
      >
        <Highlighter size={14} />
      </button>

      {/* Text color */}
      <button
        className={`rich-toolbar-btn ${activePanel === "color" ? "active" : ""}`}
        onClick={() => togglePanel("color")}
        title="Text color"
      >
        <Palette size={14} />
        <span
          className="rich-toolbar-color-dot"
          style={{ background: currentColor }}
        />
      </button>

      {/* Emoji */}
      <button
        className={`rich-toolbar-btn ${activePanel === "emoji" ? "active" : ""}`}
        onClick={() => togglePanel("emoji")}
        title="Emoji"
      >
        <Smile size={14} />
      </button>

      {/* Image */}
      <button
        className="rich-toolbar-btn"
        onClick={handleImageClick}
        title="Insert image"
      >
        <ImageIcon size={14} />
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="rich-toolbar-file-input"
        onChange={handleFileChange}
      />

      {/* Language toggle */}
      <button
        className="rich-toolbar-btn rich-toolbar-lang"
        onClick={onLanguageToggle}
        title={language === "en" ? "Switch to 中文" : "Switch to English"}
      >
        <Languages size={14} />
        <span className="rich-toolbar-lang-label">
          {language === "en" ? "EN" : "中"}
        </span>
      </button>

      {/* ── Panels ── */}

      {activePanel === "emoji" && (
        <div className="rich-panel rich-panel-emoji">
          <div className="rich-panel-header">
            <span>Emoji</span>
            <button className="rich-panel-close" onClick={() => setActivePanel(null)}>
              <X size={12} />
            </button>
          </div>
          <div className="rich-emoji-grid">
            {EMOJI_LIST.map((emoji) => (
              <button
                key={emoji}
                className="rich-emoji-btn"
                onClick={() => {
                  onInsertText?.(emoji);
                  setActivePanel(null);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {activePanel === "color" && (
        <div className="rich-panel rich-panel-color">
          <div className="rich-panel-header">
            <span>Text color</span>
            <button className="rich-panel-close" onClick={() => setActivePanel(null)}>
              <X size={12} />
            </button>
          </div>
          <div className="rich-color-grid">
            {COLOR_PALETTE.map((color) => (
              <button
                key={color}
                className={`rich-color-swatch ${currentColor === color ? "active" : ""}`}
                style={{ background: color }}
                onClick={() => {
                  onColorChange?.(color);
                  setActivePanel(null);
                }}
              />
            ))}
          </div>
        </div>
      )}

      {activePanel === "highlight" && (
        <div className="rich-panel rich-panel-color">
          <div className="rich-panel-header">
            <span>Highlight</span>
            <button className="rich-panel-close" onClick={() => setActivePanel(null)}>
              <X size={12} />
            </button>
          </div>
          <div className="rich-color-grid">
            {HIGHLIGHT_PALETTE.map((color) => (
              <button
                key={color}
                className={`rich-color-swatch rich-highlight-swatch ${currentHighlight === color ? "active" : ""} ${color === "transparent" ? "no-color" : ""}`}
                style={{ background: color === "transparent" ? "#ffffff" : color }}
                onClick={() => {
                  onHighlightChange?.(color);
                  setActivePanel(null);
                }}
              >
                {color === "transparent" ? "✕" : ""}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Icon Picker ─────────────────────────────────────── */

const GOAL_ICONS = [
  "🎯", "⭐", "🔥", "💡", "🚀", "📚", "💪", "🏃", "🎨", "🎵",
  "💻", "📝", "🌟", "💎", "🧠", "❤️", "🌈", "☀️", "🌙", "🍎",
  "🥗", "💧", "🧘", "🏋️", "📖", "✍️", "🎓", "💰", "🏠", "🌱",
  "🌸", "🦋", "🐾", "🎶", "📷", "⏰", "📅", "🗂️", "🔑", "🏆",
];

export function IconPicker({
  currentIcon,
  onSelect,
  onClose,
}: {
  currentIcon?: string;
  onSelect: (icon: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div className="icon-picker" ref={ref}>
      <div className="icon-picker-header">
        <span>Choose icon</span>
        <button className="rich-panel-close" onClick={onClose}>
          <X size={12} />
        </button>
      </div>
      <div className="icon-picker-grid">
        {/* Clear option */}
        <button
          className={`icon-picker-btn ${!currentIcon ? "active" : ""}`}
          onClick={() => { onSelect(""); onClose(); }}
        >
          ✕
        </button>
        {GOAL_ICONS.map((icon) => (
          <button
            key={icon}
            className={`icon-picker-btn ${currentIcon === icon ? "active" : ""}`}
            onClick={() => { onSelect(icon); onClose(); }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
