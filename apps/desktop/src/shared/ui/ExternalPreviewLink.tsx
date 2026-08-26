import { openUrl } from "@tauri-apps/plugin-opener";
import type { ReactNode } from "react";
import { translate } from "../i18n/messages";
import { safeExternalUrl } from "./external-url";
import { Tooltip } from "./Tooltip";

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
      <Tooltip label={translate("shared.ui.MarkdownDescriptionField.blockedLink")}>
        <span className="markdown-preview__blocked-link">{children}</span>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={translate("shared.ui.MarkdownDescriptionField.externalLink")}>
      <a
        className="markdown-preview__link"
        href={safeHref}
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
    </Tooltip>
  );
}
