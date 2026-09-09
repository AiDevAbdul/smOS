"use client";

/**
 * iOS-style segmented control. Implemented as a real tablist so arrow keys
 * work and the selected option is announced — a row of styled buttons with a
 * class on the active one would not be.
 */

export interface SegmentedProps<T extends string> {
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: SegmentedProps<T>) {
  const move = (delta: number) => {
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    if (i < 0) return;
    const next = enabled[(i + delta + enabled.length) % enabled.length];
    onChange(next.value);
  };

  return (
    <div
      className="ds-segmented"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          className="ds-segmented__btn"
          aria-selected={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
