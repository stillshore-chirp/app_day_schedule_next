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

const markdownComponents: Components = {
  a({ href, children }) {
    const safeHref = href ? safeLinkUrl(href) : "";
    return safeHref ? (
      <span
        className="markdown-preview__link"
        title={translate("shared.ui.MarkdownDescriptionField.linkNotOpened")}
      >
        {children}
        <span className="markdown-preview__link-destination"> ({safeHref})</span>
      </span>
    ) : (
      <span
        className="markdown-preview__blocked-link"
        title={translate("shared.ui.MarkdownDescriptionField.blockedLink")}
      >
        {children}
      </span>
    );
  },
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
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      urlTransform={safeLinkUrl}
      components={markdownComponents}
    >
      {value}
    </ReactMarkdown>
  );
}
