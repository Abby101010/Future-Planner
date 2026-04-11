import { describe, it, expect } from "vitest";
import { stripLoneSurrogates, sanitizeForJSON } from "./sanitize.js";

describe("stripLoneSurrogates", () => {
  it("leaves plain ASCII untouched", () => {
    expect(stripLoneSurrogates("hello world")).toBe("hello world");
  });

  it("leaves a valid surrogate pair (emoji) untouched", () => {
    const emoji = "\uD83D\uDE00"; // 😀
    expect(stripLoneSurrogates(`hi ${emoji}`)).toBe(`hi ${emoji}`);
  });

  it("replaces a lone high surrogate with U+FFFD", () => {
    expect(stripLoneSurrogates("a\uD83Db")).toBe("a\uFFFDb");
  });

  it("replaces a lone low surrogate with U+FFFD", () => {
    expect(stripLoneSurrogates("a\uDE00b")).toBe("a\uFFFDb");
  });

  it("replaces a trailing lone high surrogate", () => {
    expect(stripLoneSurrogates("a\uD83D")).toBe("a\uFFFD");
  });

  it("replaces a leading lone low surrogate", () => {
    expect(stripLoneSurrogates("\uDE00a")).toBe("\uFFFDa");
  });
});

describe("sanitizeForJSON", () => {
  it("sanitizes strings inside nested objects", () => {
    const input = { a: "ok", b: { c: "bad\uD83Dhere", d: 42 } };
    const out = sanitizeForJSON(input);
    expect(out).toEqual({ a: "ok", b: { c: "bad\uFFFDhere", d: 42 } });
  });

  it("sanitizes strings inside arrays", () => {
    const input = ["ok", "bad\uDE00", 7, null];
    expect(sanitizeForJSON(input)).toEqual(["ok", "bad\uFFFD", 7, null]);
  });

  it("passes through primitives", () => {
    expect(sanitizeForJSON(42)).toBe(42);
    expect(sanitizeForJSON(null)).toBe(null);
    expect(sanitizeForJSON(true)).toBe(true);
  });
});
