import { lazy, Suspense, useRef, useState, type KeyboardEvent } from "react";
import { translate } from "../i18n/messages";
import { PlainTextPreviewContent } from "./PlainTextPreviewContent";

const descriptionModes = ["plain", "markdown", "edit"] as const;
type DescriptionMode = (typeof descriptionModes)[number];

interface MarkdownDescriptionFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  maxLength?: number;
  disabled?: boolean;
  readOnly?: boolean;
}

const MarkdownPreviewContent = lazy(() =>
  import("./MarkdownPreviewContent").then((module) => ({
    default: module.MarkdownPreviewContent,
  })),
);

export function MarkdownDescriptionField({
  id,
  label,
  value,
  onChange,
  rows,
  maxLength,
  disabled = false,
  readOnly = false,
}: MarkdownDescriptionFieldProps) {
  const [mode, setMode] = useState<DescriptionMode>(value.trim() ? "plain" : "edit");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const helpId = `${id}-markdown-help`;
  const labelId = `${id}-label`;
  const accessibleLabel = label.trim();
  const modeLabel = translate("shared.ui.MarkdownDescriptionField.modeLabel", [accessibleLabel]);
  const showEditor = () => {
    setMode("edit");
    requestAnimationFrame(() => editorRef.current?.focus());
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % descriptionModes.length;
    if (event.key === "ArrowLeft")
      nextIndex = (index - 1 + descriptionModes.length) % descriptionModes.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = descriptionModes.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextMode = descriptionModes[nextIndex];
    if (!nextMode) return;
    setMode(nextMode);
    tabRefs.current[nextIndex]?.focus();
  };
  const modeMessages: Record<DescriptionMode, string> = {
    plain: translate("shared.ui.MarkdownDescriptionField.plainPreview"),
    markdown: translate("shared.ui.MarkdownDescriptionField.markdownPreview"),
    edit: translate("shared.ui.MarkdownDescriptionField.edit"),
  };

  return (
    <div className="markdown-field">
      <div className="markdown-field__header">
        <span className="markdown-field__label" id={labelId}>
          {accessibleLabel}
        </span>
        <div className="markdown-field__mode" role="tablist" aria-label={modeLabel}>
          {descriptionModes.map((nextMode, index) => (
            <button
              aria-controls={`${id}-${nextMode}-panel`}
              aria-selected={mode === nextMode}
              id={`${id}-${nextMode}-tab`}
              key={nextMode}
              onClick={nextMode === "edit" ? showEditor : () => setMode(nextMode)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={mode === nextMode ? 0 : -1}
              type="button"
            >
              {modeMessages[nextMode]}
            </button>
          ))}
        </div>
      </div>

      <div
        aria-labelledby={`${id}-edit-tab`}
        hidden={mode !== "edit"}
        id={`${id}-edit-panel`}
        role="tabpanel"
      >
        <textarea
          ref={editorRef}
          id={id}
          rows={rows}
          maxLength={maxLength}
          value={value}
          disabled={disabled}
          readOnly={readOnly}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>

      <section
        aria-labelledby={`${id}-plain-tab`}
        className="markdown-preview plain-text-preview"
        hidden={mode !== "plain"}
        id={`${id}-plain-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {mode === "plain" && value.trim() ? (
          <PlainTextPreviewContent value={value} />
        ) : mode === "plain" ? (
          <EmptyPreview onEdit={showEditor} />
        ) : null}
      </section>

      <section
        aria-labelledby={`${id}-markdown-tab`}
        className="markdown-preview"
        hidden={mode !== "markdown"}
        id={`${id}-markdown-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {mode === "markdown" && value.trim() ? (
          <Suspense
            fallback={
              <p role="status">{translate("shared.ui.MarkdownDescriptionField.loading")}</p>
            }
          >
            <MarkdownPreviewContent value={value} />
          </Suspense>
        ) : mode === "markdown" ? (
          <EmptyPreview onEdit={showEditor} />
        ) : null}
      </section>

      <p className="field-help" id={helpId}>
        {translate("shared.ui.MarkdownDescriptionField.help")}
      </p>
    </div>
  );
}

function EmptyPreview({ onEdit }: { onEdit: () => void }) {
  return (
    <div className="markdown-preview__empty">
      <p>{translate("shared.ui.MarkdownDescriptionField.empty")}</p>
      <button className="button" type="button" onClick={onEdit}>
        {translate("shared.ui.MarkdownDescriptionField.returnToEdit")}
      </button>
    </div>
  );
}
