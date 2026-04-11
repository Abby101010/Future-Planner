import { describe, it, expect } from "vitest";
import { personalizeSystem } from "./personalize";

describe("personalizeSystem", () => {
  it("returns the base prompt unchanged when memory context is empty", () => {
    expect(personalizeSystem("BASE", "")).toBe("BASE");
  });

  it("appends memory context after a blank line", () => {
    expect(personalizeSystem("BASE", "MEM")).toBe("BASE\n\nMEM");
  });
});
