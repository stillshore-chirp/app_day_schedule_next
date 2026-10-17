import { useState } from "react";
import type { AppClient } from "../../shared/ipc/client";
import { translate } from "../../shared/i18n/messages";
import { Tooltip } from "../../shared/ui/Tooltip";

export function FloatingDayOverviewLauncher({ client }: { client: AppClient }) {
  const [error, setError] = useState(false);
  const label = translate("actions.openDayOverview");

  const openOverview = async () => {
    setError(false);
    try {
      await client.openDayOverviewWindow();
    } catch {
      setError(true);
    }
  };

  return (
    <div className="day-overview-launcher-wrap">
      <Tooltip label={label}>
        <button
          className="day-overview-launcher"
          type="button"
          aria-label={label}
          onClick={() => void openOverview()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6.5h16M4 12h16M4 17.5h16" />
            <path d="M7 4v5M13 9.5v5M18 15v5" />
          </svg>
        </button>
      </Tooltip>
      {error ? (
        <span className="analog-clock-launcher__error" role="alert">
          {translate("actions.openDayOverviewFailed")}
        </span>
      ) : null}
    </div>
  );
}
