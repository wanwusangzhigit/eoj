import './LoadingSpinner.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  style?: React.CSSProperties;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 6, style }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function SkeletonRow({ count = 1 }: { count?: number }) {
  return (
    <div className="skeleton-row">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-row-inner">
          <Skeleton width={40} height={40} borderRadius={8} />
          <div className="skeleton-row-text">
            <Skeleton width="60%" height={14} />
            <Skeleton width="40%" height={12} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="skeleton-table">
      <div className="skeleton-table-header">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} width={`${20 + i * 15}%`} height={16} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-table-row">
          {Array.from({ length: 4 }).map((_, j) => (
            <Skeleton key={j} width={`${15 + j * 10}%`} height={14} />
          ))}
        </div>
      ))}
    </div>
  );
}
