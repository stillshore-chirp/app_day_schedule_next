import { lazy, Suspense, useRef, useState } from "react";
import { translate } from "../i18n/messages";

type MarkdownMode = "edit" | "preview";

interface MarkdownDescriptionFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
  maxLength?: number;
  disabled?: boolean;
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
}: MarkdownDescriptionFieldProps) {
  const [mode, setMode] = useState<MarkdownMode>(value.trim() ? "preview" : "edit");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const helpId = `${id}-markdown-help`;
  const labelId = `${id}-label`;
  const accessibleLabel = label.trim();
  const modeLabel = translate("shared.ui.MarkdownDescriptionField.modeLabel", [accessibleLabel]);
  const showEditor = () => {
    setMode("edit");
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  return (
    <div className="markdown-field">
      <div className="markdown-field__header">
        <span className="markdown-field__label" id={labelId}>
          {accessibleLabel}
        </span>
        <div className="markdown-field__mode" role="group" aria-label={modeLabel}>
          <button type="button" aria-pressed={mode === "edit"} onClick={showEditor}>
            {translate("shared.ui.MarkdownDescriptionField.edit")}
          </button>
          <button
            type="button"
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            {translate("shared.ui.MarkdownDescriptionField.preview")}
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <textarea
          ref={editorRef}
          id={id}
          rows={rows}
          maxLength={maxLength}
          value={value}
          disabled={disabled}
          aria-labelledby={labelId}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <section
          className="markdown-preview"
          role="region"
          aria-label={translate("shared.ui.MarkdownDescriptionField.previewLabel", [
            accessibleLabel,
          ])}
          tabIndex={0}
        >
          {value.trim() ? (
            <Suspense
              fallback={
                <p role="status">{translate("shared.ui.MarkdownDescriptionField.loading")}</p>
              }
            >
              <MarkdownPreviewContent value={value} />
            </Suspense>
          ) : (
            <div className="markdown-preview__empty">
              <p>{translate("shared.ui.MarkdownDescriptionField.empty")}</p>
              <button className="button" type="button" onClick={showEditor}>
                {translate("shared.ui.MarkdownDescriptionField.returnToEdit")}
              </button>
            </div>
          )}
        </section>
      )}

      <p className="field-help" id={helpId}>
        {translate("shared.ui.MarkdownDescriptionField.help")}
      </p>
    </div>
  );
}
