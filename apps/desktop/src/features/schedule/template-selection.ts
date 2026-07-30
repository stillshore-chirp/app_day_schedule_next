import type { DayTemplate } from "../../shared/contracts";

export function resolveDisplayedTemplate(
  templates: DayTemplate[],
  lastTemplateId: string | null,
): DayTemplate | null {
  return templates.find((item) => item.id === lastTemplateId) ?? templates[0] ?? null;
}
