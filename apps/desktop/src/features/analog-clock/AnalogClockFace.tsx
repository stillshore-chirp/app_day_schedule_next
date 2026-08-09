import { appLocale, translate } from "../../shared/i18n/messages";
import { clockHandAngles } from "./clock-model";

const marks = Array.from({ length: 60 }, (_, index) => index);
const numbers = Array.from({ length: 12 }, (_, index) => index + 1);

export function AnalogClockFace({ now, compact = false }: { now: Date; compact?: boolean }) {
  const angles = clockHandAngles(now);
  const accessibleTime = new Intl.DateTimeFormat(appLocale, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  return (
    <svg
      className={`analog-clock-face ${
        compact ? "analog-clock-face--compact" : "analog-clock-face--full"
      }`}
      viewBox="0 0 100 100"
      role={compact ? undefined : "img"}
      aria-label={compact ? undefined : translate("app.AnalogClock.022", [accessibleTime])}
      aria-hidden={compact ? "true" : undefined}
    >
      <circle className="analog-clock-face__dial" cx="50" cy="50" r="47" />
      <g className="analog-clock-face__marks" aria-hidden="true">
        {marks.map((mark) => (
          <line
            key={mark}
            className={mark % 5 === 0 ? "analog-clock-face__mark--hour" : undefined}
            x1="50"
            y1={mark % 5 === 0 ? "5" : "6.5"}
            x2="50"
            y2={mark % 5 === 0 ? "11" : "9.5"}
            transform={`rotate(${mark * 6} 50 50)`}
          />
        ))}
      </g>
      {!compact ? (
        <g className="analog-clock-face__numbers" aria-hidden="true">
          {numbers.map((number) => {
            const angle = ((number * 30 - 90) * Math.PI) / 180;
            return (
              <text
                key={number}
                x={50 + 35 * Math.cos(angle)}
                y={50 + 35 * Math.sin(angle)}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {number}
              </text>
            );
          })}
        </g>
      ) : null}
      <g className="analog-clock-face__hands" aria-hidden="true">
        <line
          className="analog-clock-face__hand analog-clock-face__hand--hour"
          x1="50"
          y1="53"
          x2="50"
          y2={compact ? "32" : "29"}
          transform={`rotate(${angles.hour} 50 50)`}
        />
        <line
          className="analog-clock-face__hand analog-clock-face__hand--minute"
          x1="50"
          y1="54"
          x2="50"
          y2={compact ? "24" : "19"}
          transform={`rotate(${angles.minute} 50 50)`}
        />
        <line
          className="analog-clock-face__hand analog-clock-face__hand--second"
          x1="50"
          y1="57"
          x2="50"
          y2="14"
          transform={`rotate(${angles.second} 50 50)`}
        />
        <circle className="analog-clock-face__pin" cx="50" cy="50" r={compact ? "3.5" : "2.4"} />
      </g>
    </svg>
  );
}
