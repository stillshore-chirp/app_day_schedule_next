import { useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { translate } from "../i18n/messages";
import { ExternalPreviewLink } from "./ExternalPreviewLink";
import { safeExternalUrl } from "./external-url";

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
        return (
          <ExternalPreviewLink
            href={href ?? ""}
            showDestination
            onOpenFailureChange={setLinkOpenFailed}
          >
            {children}
          </ExternalPreviewLink>
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
        urlTransform={safeExternalUrl}
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
