import { useMemo } from 'react';
import { getRatingColor } from '../utils/rating';
import './RatingChart.css';

export interface RatingPoint {
  id: number;
  old_rating: number;
  new_rating: number;
  delta: number;
  contest_id: number | null;
  contest_title?: string;
  created_at: string;
}

interface RatingChartProps {
  history: RatingPoint[];
  height?: number;
}

/**
 * A lightweight SVG line chart showing the user's rating history over time.
 * Uses the platform's rating color palette. Self-drawn to avoid pulling in recharts.
 */
export default function RatingChart({ history, height = 220 }: RatingChartProps) {
  const width = 720;
  const padding = { top: 24, right: 20, bottom: 36, left: 50 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { points, minR, maxR, yTicks, xLabels } = useMemo(() => {
    if (history.length === 0) {
      return { points: [], minR: 0, maxR: 1000, yTicks: [0, 250, 500, 750, 1000], xLabels: [] };
    }

    // Reverse so oldest is first
    const ordered = [...history].reverse();

    const ratings = ordered.flatMap((p) => [p.old_rating, p.new_rating]);
    let minR = Math.min(...ratings);
    let maxR = Math.max(...ratings);
    // pad range
    const span = Math.max(100, maxR - minR);
    minR = Math.max(0, Math.floor((minR - span * 0.1) / 50) * 50);
    maxR = Math.ceil((maxR + span * 0.1) / 50) * 50;
    if (maxR - minR < 200) maxR = minR + 200;

    const step = Math.max(1, Math.floor((maxR - minR) / 5 / 50) * 50);
    const ticks: number[] = [];
    for (let v = minR; v <= maxR; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] < maxR) ticks.push(maxR);

    const n = ordered.length;
    // x position: spread evenly across chart width
    // For n=1, place at midpoint
    const pts = ordered.map((p, i) => {
      const x = n === 1 ? chartW / 2 : (i / (n - 1)) * chartW;
      const y = chartH - ((p.new_rating - minR) / (maxR - minR)) * chartH;
      return { x, y, rating: p.new_rating, point: p };
    });

    // Show ~5 evenly spaced x labels
    const labelIdxs: number[] = [];
    if (n <= 5) {
      for (let i = 0; i < n; i++) labelIdxs.push(i);
    } else {
      for (let i = 0; i < 5; i++) labelIdxs.push(Math.round((i * (n - 1)) / 4));
    }
    const xLabels = labelIdxs.map((idx) => ({
      x: pts[idx].x,
      label: new Date(ordered[idx].created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }));

    return { points: pts, minR, maxR, yTicks: ticks, xLabels };
  }, [history, chartW, chartH]);

  if (history.length === 0) {
    return (
      <div className="rating-chart-empty">
        <p>暂无 Rating 历史</p>
      </div>
    );
  }

  // Build path string for the line
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  // Build area path (for fill under line)
  const areaPath = points.length > 0
    ? `M ${points[0].x.toFixed(1)} ${chartH} ` +
      points.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') +
      ` L ${points[points.length - 1].x.toFixed(1)} ${chartH} Z`
    : '';

  const lastPoint = points[points.length - 1];
  const firstRating = points[0].point.old_rating;
  const lastRating = lastPoint.point.new_rating;
  const totalDelta = lastRating - firstRating;

  return (
    <div className="rating-chart">
      <div className="rating-chart-header">
        <div className="rating-chart-summary">
          <span className="rating-chart-current" style={{ color: getRatingColor(lastRating) }}>
            {lastRating}
          </span>
          <span className={`rating-chart-delta ${totalDelta >= 0 ? 'positive' : 'negative'}`}>
            {totalDelta >= 0 ? '+' : ''}{totalDelta}
          </span>
          <span className="rating-chart-count">{history.length} 场比赛</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="rating-chart-svg" preserveAspectRatio="xMidYMid meet">
        {/* Y-axis grid lines + labels */}
        {yTicks.map((tick) => {
          const y = chartH - ((tick - minR) / (maxR - minR)) * chartH;
          return (
            <g key={`y-${tick}`}>
              <line
                x1={padding.left}
                y1={y + padding.top}
                x2={width - padding.right}
                y2={y + padding.top}
                stroke="var(--border)"
                strokeWidth="1"
                strokeDasharray="2 4"
              />
              <text
                x={padding.left - 8}
                y={y + padding.top + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-muted)"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        {areaPath && (
          <path
            d={areaPath}
            fill="var(--accent)"
            opacity="0.12"
            transform={`translate(${padding.left}, ${padding.top})`}
          />
        )}

        {/* Line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          transform={`translate(${padding.left}, ${padding.top})`}
        />

        {/* Points */}
        {points.map((p, i) => (
          <g key={p.point.id || i} transform={`translate(${padding.left + p.x}, ${padding.top + p.y})`}>
            <circle
              r="3.5"
              fill={getRatingColor(p.rating)}
              stroke="var(--bg-primary)"
              strokeWidth="1.5"
            />
            <title>
              {p.point.contest_title || `Contest #${p.point.contest_id || '?'}}`}
              {'\n'}
              {p.point.old_rating} → {p.point.new_rating} ({p.point.delta >= 0 ? '+' : ''}{p.point.delta})
              {'\n'}
              {new Date(p.point.created_at).toLocaleString()}
            </title>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map((xl, i) => (
          <text
            key={`x-${i}`}
            x={padding.left + xl.x}
            y={height - 10}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
          >
            {xl.label}
          </text>
        ))}

        {/* Y-axis label */}
        <text
          x={12}
          y={padding.top + chartH / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          transform={`rotate(-90, 12, ${padding.top + chartH / 2})`}
        >
          Rating
        </text>
      </svg>
    </div>
  );
}
