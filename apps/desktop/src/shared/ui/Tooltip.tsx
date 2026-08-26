import { createPortal } from "react-dom";
import {
  cloneElement,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type ReactElement,
} from "react";

interface TooltipChildProps {
  "aria-describedby"?: string;
  onBlur?: FocusEventHandler<HTMLElement>;
  onFocus?: FocusEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onMouseEnter?: MouseEventHandler<HTMLElement>;
  onMouseLeave?: MouseEventHandler<HTMLElement>;
}

interface TooltipProps {
  label: string;
  children: ReactElement;
}

interface TooltipPosition {
  left: number;
  top: number;
}

const VIEWPORT_PADDING = 8;
const TRIGGER_GAP = 8;
const FALLBACK_TOOLTIP_WIDTH = 384;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Displays a scale-aware tooltip in a body portal so it is not clipped by an
 * overflow container. The trigger itself remains the original DOM element,
 * preserving its native layout and accessible name.
 */
export function Tooltip({ label, children }: TooltipProps) {
  const childProps = children.props as TooltipChildProps;
  const tooltipId = `app-tooltip-${useId().replaceAll(":", "")}`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const tooltipRef = useRef<HTMLSpanElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const visible = Boolean(label) && !dismissed && (hovered || focused);

  const show = useCallback((target: HTMLElement) => {
    triggerRef.current = target;
    setDismissed(false);
    setHovered(true);
  }, []);

  const onMouseEnter: MouseEventHandler<HTMLElement> = (event) => {
    childProps.onMouseEnter?.(event);
    show(event.currentTarget);
  };

  const onMouseLeave: MouseEventHandler<HTMLElement> = (event) => {
    childProps.onMouseLeave?.(event);
    setHovered(false);
  };

  const onFocus: FocusEventHandler<HTMLElement> = (event) => {
    childProps.onFocus?.(event);
    triggerRef.current = event.currentTarget;
    setDismissed(false);
    setFocused(true);
  };

  const onBlur: FocusEventHandler<HTMLElement> = (event) => {
    childProps.onBlur?.(event);
    setFocused(false);
  };

  const onKeyDown: KeyboardEventHandler<HTMLElement> = (event) => {
    childProps.onKeyDown?.(event);
    if (event.key === "Escape") setDismissed(true);
  };

  useLayoutEffect(() => {
    if (!visible) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const tooltipRect = tooltipRef.current?.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const tooltipWidth =
        tooltipRect?.width ||
        Math.min(FALLBACK_TOOLTIP_WIDTH, Math.max(0, viewportWidth - VIEWPORT_PADDING * 2));
      const tooltipHeight = tooltipRect?.height || 0;
      const left = clamp(
        triggerRect.left + triggerRect.width / 2 - tooltipWidth / 2,
        VIEWPORT_PADDING,
        Math.max(VIEWPORT_PADDING, viewportWidth - tooltipWidth - VIEWPORT_PADDING),
      );
      const belowTop = triggerRect.bottom + TRIGGER_GAP;
      const aboveTop = triggerRect.top - tooltipHeight - TRIGGER_GAP;
      const top =
        tooltipHeight > 0 && belowTop + tooltipHeight > viewportHeight - VIEWPORT_PADDING
          ? Math.max(VIEWPORT_PADDING, aboveTop)
          : belowTop;

      setPosition((current) =>
        current.left === left && current.top === top ? current : { left, top },
      );
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined" || !tooltipRef.current
        ? null
        : new ResizeObserver(updatePosition);
    if (resizeObserver && tooltipRef.current) resizeObserver.observe(tooltipRef.current);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [visible]);

  if (!label) return children;

  const describedBy = [childProps["aria-describedby"], visible ? tooltipId : undefined]
    .filter(Boolean)
    .join(" ");
  const trigger = cloneElement(children, {
    "aria-describedby": describedBy || undefined,
    onBlur,
    onFocus,
    onKeyDown,
    onMouseEnter,
    onMouseLeave,
  } as Partial<TooltipChildProps>);

  return (
    <>
      {trigger}
      {visible
        ? createPortal(
            <span
              ref={tooltipRef}
              id={tooltipId}
              className="app-tooltip"
              role="tooltip"
              style={{ left: `${position.left}px`, top: `${position.top}px` }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
