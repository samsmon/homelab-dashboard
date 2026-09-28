import React, { useState, useId } from 'react';

export type GraphTone = 'accent' | 'good' | 'warn' | 'bad' | 'purple' | 'cyan';

interface PerformanceGraphProps {
  title: string;
  subtitle?: string;
  data: number[];
  secondaryData?: number[];
  tone?: GraphTone;
  secondaryTone?: GraphTone;
  valueFormatter?: (val: number) => string;
  secondaryFormatter?: (val: number) => string;
  secondaryLabel?: string;
  maxScale?: number | 'auto';
  height?: number;
  unit?: string;
  timeWindowSeconds?: number;
}

const COLOR_MAP: Record<GraphTone, { stroke: string; fill: string; hex: string }> = {
  accent: { stroke: '#7c9cff', fill: 'rgba(124, 156, 255, 0.22)', hex: '#7c9cff' },
  good: { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.22)', hex: '#22c55e' },
  warn: { stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.22)', hex: '#f59e0b' },
  bad: { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.22)', hex: '#ef4444' },
  purple: { stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.22)', hex: '#a855f7' },
  cyan: { stroke: '#06b6d4', fill: 'rgba(6, 182, 212, 0.22)', hex: '#06b6d4' },
};

export const PerformanceGraph: React.FC<PerformanceGraphProps> = ({
  title,
  subtitle,
  data,
  secondaryData,
  tone = 'accent',
  secondaryTone = 'cyan',
  valueFormatter = (val) => `${val.toFixed(1)}%`,
  secondaryFormatter,
  secondaryLabel,
  maxScale = 100,
  height = 180,
  timeWindowSeconds = 60,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const idPrefix = useId();

  const width = 600;
  const paddingLeft = 40;
  const paddingRight = 14;
  const paddingTop = 14;
  const paddingBottom = 22;

  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const primaryColors = COLOR_MAP[tone] || COLOR_MAP.accent;
  const secColors = COLOR_MAP[secondaryTone] || COLOR_MAP.cyan;

  const currentVal = data.length > 0 ? data[data.length - 1] : 0;
  const currentSecVal = secondaryData && secondaryData.length > 0 ? secondaryData[secondaryData.length - 1] : null;

  // Compute scale max
  let effectiveMax = 100;
  if (maxScale === 'auto') {
    const maxPrimary = Math.max(...(data.length > 0 ? data : [0]));
    const maxSecondary = secondaryData && secondaryData.length > 0 ? Math.max(...secondaryData) : 0;
    const computedMax = Math.max(maxPrimary, maxSecondary);
    effectiveMax = computedMax <= 0 ? 10 : computedMax * 1.15;
  } else {
    effectiveMax = maxScale;
  }

  // Generate SVG coordinates
  const computePoints = (dataset: number[]) => {
    if (!dataset || dataset.length === 0) return [];
    const len = dataset.length;
    return dataset.map((val, idx) => {
      const x = paddingLeft + (idx / Math.max(1, len - 1)) * plotWidth;
      const normalized = Math.min(effectiveMax, Math.max(0, val)) / effectiveMax;
      const y = paddingTop + plotHeight - normalized * plotHeight;
      return { x, y, val };
    });
  };

  const primaryPoints = computePoints(data);
  const secondaryPoints = secondaryData ? computePoints(secondaryData) : [];

  const buildPath = (pts: { x: number; y: number }[]) => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].x},${pts[0].y} L ${pts[0].x + 1},${pts[0].y}`;
    return `M ${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ')}`;
  };

  const primaryPath = buildPath(primaryPoints);
  const secondaryPath = buildPath(secondaryPoints);

  const baselineY = paddingTop + plotHeight;
  const primaryArea =
    primaryPoints.length > 1
      ? `${primaryPath} L ${primaryPoints[primaryPoints.length - 1].x.toFixed(1)},${baselineY} L ${primaryPoints[0].x.toFixed(1)},${baselineY} Z`
      : '';
  const secondaryArea =
    secondaryPoints.length > 1
      ? `${secondaryPath} L ${secondaryPoints[secondaryPoints.length - 1].x.toFixed(1)},${baselineY} L ${secondaryPoints[0].x.toFixed(1)},${baselineY} Z`
      : '';

  // Grid steps (4 horizontal bands: 0%, 33%, 66%, 100% or 0, 25, 50, 75, 100)
  const gridSteps = [0, 0.25, 0.5, 0.75, 1.0];
  const verticalGridCount = 5; // e.g. -60s, -45s, -30s, -15s, 0s

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;

    if (svgX < paddingLeft || svgX > width - paddingRight || data.length === 0) {
      setHoverIndex(null);
      return;
    }

    const ratio = (svgX - paddingLeft) / plotWidth;
    const index = Math.round(ratio * (data.length - 1));
    const clampedIndex = Math.max(0, Math.min(data.length - 1, index));
    setHoverIndex(clampedIndex);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoverPointPrimary = hoverIndex !== null && primaryPoints[hoverIndex] ? primaryPoints[hoverIndex] : null;
  const hoverPointSecondary = hoverIndex !== null && secondaryPoints[hoverIndex] ? secondaryPoints[hoverIndex] : null;
  const secondsAgo = hoverIndex !== null ? Math.round(((data.length - 1 - hoverIndex) / Math.max(1, data.length - 1)) * timeWindowSeconds) : 0;

  return (
    <div className="panel flex flex-col p-4 relative group">
      {/* Header Info */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full shadow-sm"
              style={{ backgroundColor: primaryColors.hex }}
            />
            <h3 className="text-[13.5px] font-semibold text-cockpit-text tracking-tight">{title}</h3>
            {secondaryLabel && (
              <span className="flex items-center gap-1 text-[11px] text-cockpit-muted ml-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: secColors.hex }}
                />
                {secondaryLabel}
              </span>
            )}
          </div>
          {subtitle && <p className="text-[11px] text-cockpit-muted font-mono mt-0.5">{subtitle}</p>}
        </div>

        {/* Live Badges */}
        <div className="text-right">
          <div className="flex items-baseline justify-end gap-1.5">
            <span className="font-mono text-[16px] font-bold tabular-nums text-cockpit-text">
              {valueFormatter(currentVal)}
            </span>
            {currentSecVal !== null && secondaryFormatter && (
              <span
                className="font-mono text-[12.5px] font-medium tabular-nums"
                style={{ color: secColors.hex }}
              >
                / {secondaryFormatter(currentSecVal)}
              </span>
            )}
          </div>
          <span className="text-[10px] uppercase font-mono tracking-wider text-cockpit-muted">
            60s rolling
          </span>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="w-full relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width="100%"
          height={height}
          preserveAspectRatio="none"
          className="overflow-visible select-none cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id={`${idPrefix}-primary-grad`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primaryColors.hex} stopOpacity="0.28" />
              <stop offset="100%" stopColor={primaryColors.hex} stopOpacity="0.01" />
            </linearGradient>
            {secondaryData && (
              <linearGradient id={`${idPrefix}-sec-grad`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={secColors.hex} stopOpacity="0.22" />
                <stop offset="100%" stopColor={secColors.hex} stopOpacity="0.01" />
              </linearGradient>
            )}
          </defs>

          {/* Background Task-Manager-Style Grid */}
          {gridSteps.map((step) => {
            const y = paddingTop + plotHeight - step * plotHeight;
            const labelVal = step * effectiveMax;
            return (
              <g key={`h-grid-${step}`}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={width - paddingRight}
                  y2={y}
                  stroke="currentColor"
                  className="text-cockpit-border/40"
                  strokeWidth="1"
                  strokeDasharray={step > 0 && step < 1 ? '2 2' : undefined}
                />
                <text
                  x={paddingLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  className="fill-cockpit-muted text-[9.5px] font-mono tabular-nums"
                >
                  {valueFormatter(labelVal).replace(/[^0-9.KMGT%°C]/g, '')}
                </text>
              </g>
            );
          })}

          {/* Vertical grid lines */}
          {Array.from({ length: verticalGridCount }).map((_, i) => {
            const ratio = i / (verticalGridCount - 1);
            const x = paddingLeft + ratio * plotWidth;
            const secMarker = Math.round(timeWindowSeconds * (1 - ratio));
            return (
              <g key={`v-grid-${i}`}>
                <line
                  x1={x}
                  y1={paddingTop}
                  x2={x}
                  y2={paddingTop + plotHeight}
                  stroke="currentColor"
                  className="text-cockpit-border/30"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                <text
                  x={x}
                  y={height - 5}
                  textAnchor="middle"
                  className="fill-cockpit-muted text-[9px] font-mono tabular-nums"
                >
                  {secMarker === 0 ? 'now' : `-${secMarker}s`}
                </text>
              </g>
            );
          })}

          {/* Area Gradients & Curve Lines */}
          {secondaryArea && (
            <path d={secondaryArea} fill={`url(#${idPrefix}-sec-grad)`} />
          )}
          {primaryArea && (
            <path d={primaryArea} fill={`url(#${idPrefix}-primary-grad)`} />
          )}

          {secondaryPath && (
            <path
              d={secondaryPath}
              fill="none"
              stroke={secColors.stroke}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {primaryPath && (
            <path
              d={primaryPath}
              fill="none"
              stroke={primaryColors.stroke}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Pulse marker on newest live point */}
          {primaryPoints.length > 0 && (
            <circle
              cx={primaryPoints[primaryPoints.length - 1].x}
              cy={primaryPoints[primaryPoints.length - 1].y}
              r="2.8"
              fill={primaryColors.stroke}
              className="drop-shadow"
            />
          )}

          {/* Interactive Scrubbing Crosshair & Tooltip */}
          {hoverPointPrimary && (
            <g>
              <line
                x1={hoverPointPrimary.x}
                y1={paddingTop}
                x2={hoverPointPrimary.x}
                y2={paddingTop + plotHeight}
                stroke={primaryColors.stroke}
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.8"
              />
              <circle
                cx={hoverPointPrimary.x}
                cy={hoverPointPrimary.y}
                r="4"
                fill={primaryColors.stroke}
                stroke="#181a20"
                strokeWidth="1.5"
              />
              {hoverPointSecondary && (
                <circle
                  cx={hoverPointSecondary.x}
                  cy={hoverPointSecondary.y}
                  r="3.5"
                  fill={secColors.stroke}
                  stroke="#181a20"
                  strokeWidth="1.5"
                />
              )}
            </g>
          )}
        </svg>

        {/* Hover Floating Tooltip Badge */}
        {hoverPointPrimary && (
          <div
            className="absolute pointer-events-none rounded bg-cockpit-panel/95 backdrop-blur-md border border-cockpit-border px-2.5 py-1 text-[11px] shadow-lg font-mono z-20 flex flex-col gap-0.5"
            style={{
              left: `${(hoverPointPrimary.x / width) * 100}%`,
              top: '8px',
              transform: hoverPointPrimary.x > width * 0.75 ? 'translateX(-105%)' : 'translateX(8px)',
            }}
          >
            <span className="text-cockpit-muted text-[9.5px]">
              {secondsAgo === 0 ? 'Current / Live' : `${secondsAgo}s ago`}
            </span>
            <div className="flex items-center gap-1.5 font-semibold text-cockpit-text">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: primaryColors.hex }} />
              <span>{valueFormatter(hoverPointPrimary.val)}</span>
            </div>
            {hoverPointSecondary && secondaryFormatter && (
              <div className="flex items-center gap-1.5 font-medium" style={{ color: secColors.hex }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: secColors.hex }} />
                <span>{secondaryFormatter(hoverPointSecondary.val)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
