import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { translate } from "../i18n/messages";
import { safeExternalUrl } from "./external-url";

export function ExternalPreviewLink({
  href,
  children,
  showDestination = false,
  onOpenFailureChange,
}: {
  href: string;
  children: ReactNode;
  showDestination?: boolean;
  onOpenFailureChange: (failed: boolean) => void;
}) {
  const safeHref = safeExternalUrl(href);

  if (!safeHref) {
    return (
      <span
        className="markdown-preview__blocked-link"
        title={translate("shared.ui.MarkdownDescriptionField.blockedLink")}
      >
        {children}
      </span>
    );
  }

  return (
    <a
      className="markdown-preview__link"
      href={safeHref}
      title={translate("shared.ui.MarkdownDescriptionField.externalLink")}
      onClick={(event) => {
        event.preventDefault();
        onOpenFailureChange(false);
        void openUrl(safeHref).catch(() => onOpenFailureChange(true));
      }}
      onAuxClick={(event) => event.preventDefault()}
    >
      {children}
      {showDestination ? (
        <span className="markdown-preview__link-destination"> ({safeHref})</span>
      ) : null}
    </a>
  );
}
