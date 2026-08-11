import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { translate } from "../i18n/messages";

function safeLinkUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

const nonLinkMarkdownComponents: Pick<Components, "img" | "input"> = {
  img({ alt }) {
    return (
      <span className="markdown-preview__image-placeholder">
        {translate("shared.ui.MarkdownDescriptionField.blockedImage", [
          alt || translate("shared.ui.MarkdownDescriptionField.imageWithoutAlt"),
        ])}
      </span>
    );
  },
  input({ checked }) {
    return (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled
        aria-label={translate(
          checked
            ? "shared.ui.MarkdownDescriptionField.checkedTask"
            : "shared.ui.MarkdownDescriptionField.uncheckedTask",
        )}
      />
    );
  },
};

export function MarkdownPreviewContent({ value }: { value: string }) {
  const [linkOpenFailed, setLinkOpenFailed] = useState(false);
  const markdownComponents = useMemo<Components>(
    () => ({
      ...nonLinkMarkdownComponents,
      a({ href, children }) {
        const safeHref = href ? safeLinkUrl(href) : "";
        return safeHref ? (
          <a
            className="markdown-preview__link"
            href={safeHref}
            title={translate("shared.ui.MarkdownDescriptionField.externalLink")}
            onClick={(event) => {
              event.preventDefault();
              setLinkOpenFailed(false);
              void openUrl(safeHref).catch(() => setLinkOpenFailed(true));
            }}
            onAuxClick={(event) => event.preventDefault()}
          >
            {children}
            <span className="markdown-preview__link-destination"> ({safeHref})</span>
          </a>
        ) : (
          <span
            className="markdown-preview__blocked-link"
            title={translate("shared.ui.MarkdownDescriptionField.blockedLink")}
          >
            {children}
          </span>
        );
      },
    }),
    [],
  );

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeLinkUrl}
        components={markdownComponents}
      >
        {value}
      </ReactMarkdown>
      {linkOpenFailed ? (
        <p className="field-error" role="alert">
          {translate("shared.ui.MarkdownDescriptionField.linkOpenFailed")}
        </p>
      ) : null}
    </>
  );
}
