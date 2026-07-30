import { describe, expect, it } from "vitest";
import type { DayTemplate } from "../../shared/contracts";
import { resolveDisplayedTemplate } from "./template-selection";

function template(id: string, sortOrder: number): DayTemplate {
  return {
    id,
    name: id,
    description: "",
    color: "#6F96F4",
    weekdaysMask: 127,
    isBuiltin: false,
    sortOrder,
    version: 0,
    blocks: [],
  };
}

describe("resolveDisplayedTemplate", () => {
  const first = template("00000000-0000-4000-8000-000000000001", 0);
  const second = template("00000000-0000-4000-8000-000000000002", 1);

  it("uses lastTemplateId when it exists", () => {
    expect(resolveDisplayedTemplate([first, second], second.id)).toBe(second);
  });

  it("falls back deterministically for null or stale IDs", () => {
    expect(resolveDisplayedTemplate([first, second], null)).toBe(first);
    expect(resolveDisplayedTemplate([first, second], "00000000-0000-4000-8000-000000000099")).toBe(
      first,
    );
  });

  it("returns null when no template exists", () => {
    expect(resolveDisplayedTemplate([], null)).toBeNull();
  });
});
