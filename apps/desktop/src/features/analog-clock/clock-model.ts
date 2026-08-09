export type AnalogClockThemeMode = "auto" | "light" | "dark";
export type AnalogClockScale = 1 | 1.5 | 2 | 2.5;

export interface ClockHandAngles {
  hour: number;
  minute: number;
  second: number;
}

export const analogClockScales: readonly AnalogClockScale[] = [1, 1.5, 2, 2.5];

export function clockHandAngles(now: Date): ClockHandAngles {
  const second = now.getSeconds() + now.getMilliseconds() / 1_000;
  const minute = now.getMinutes() + second / 60;
  const hour = (now.getHours() % 12) + minute / 60;
  return {
    hour: hour * 30,
    minute: minute * 6,
    second: second * 6,
  };
}

export function resolvedClockTheme(mode: AnalogClockThemeMode, now: Date): "light" | "dark" {
  if (mode !== "auto") return mode;
  const hour = now.getHours();
  return hour < 6 || hour >= 18 ? "dark" : "light";
}

export function nextAnalogClockScale(current: AnalogClockScale): AnalogClockScale {
  const index = analogClockScales.indexOf(current);
  return analogClockScales[(index + 1) % analogClockScales.length] ?? 1;
}
