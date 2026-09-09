"use client";

/**
 * Shared Recharts tooltip. The one place in the Console where glass sits over
 * data, and it's legitimate: the tooltip is chrome that floats above the plot,
 * uses the --strong alpha, and is pointer-transparent.
 */

import { fmtNumber } from "../../lib/format";

export interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

export interface GlassTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipEntry[];
  /** Per-series value formatter, keyed by dataKey. */
  format?: Record<string, (v: number) => string>;
  labelFormat?: (l: string | number) => string;
}

export default function GlassTooltip({
  active,
  label,
  payload,
  format,
  labelFormat,
}: GlassTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="ds-tooltip-glass" role="tooltip">
      {label != null && (
        <div className="ds-tooltip-glass__label">
          {labelFormat ? labelFormat(label) : String(label)}
        </div>
      )}
      {payload.map((e, i) => {
        const key = String(e.dataKey ?? e.name ?? i);
        const raw = typeof e.value === "number" ? e.value : Number(e.value);
        const shown =
          format?.[key] && Number.isFinite(raw)
            ? format[key](raw)
            : Number.isFinite(raw)
              ? fmtNumber(raw, raw % 1 === 0 ? 0 : 2)
              : String(e.value ?? "—");
        return (
          <div className="ds-tooltip-glass__row" key={key}>
            <span className="ds-tooltip-glass__swatch" style={{ background: e.color }} aria-hidden="true" />
            <span>{e.name ?? key}</span>
            <span className="ds-tooltip-glass__val">{shown}</span>
          </div>
        );
      })}
    </div>
  );
}
