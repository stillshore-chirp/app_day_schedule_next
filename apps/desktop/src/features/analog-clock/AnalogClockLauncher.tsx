import { useState } from "react";
import type { AppClient } from "../../shared/ipc/client";
import { translate } from "../../shared/i18n/messages";
import { Tooltip } from "../../shared/ui/Tooltip";
import { AnalogClockFace } from "./AnalogClockFace";
import { useWallClock } from "./use-wall-clock";

export function AnalogClockLauncher({ client }: { client: AppClient }) {
  const now = useWallClock();
  const [error, setError] = useState("");
  const label = translate("actions.openAnalogClock");

  const openClock = async () => {
    setError("");
    try {
      await client.openAnalogClockWindow();
    } catch {
      setError(translate("actions.openAnalogClockFailed"));
    }
  };

  return (
    <div className="analog-clock-launcher-wrap">
      <Tooltip label={label}>
        <button
          className="analog-clock-launcher"
          type="button"
          aria-label={label}
          onClick={() => void openClock()}
        >
          <AnalogClockFace now={now} compact />
        </button>
      </Tooltip>
      {error ? (
        <span className="analog-clock-launcher__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
