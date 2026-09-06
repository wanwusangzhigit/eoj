import { getRatingColor, getRatingLabel } from '../utils/rating';

interface RatingBadgeProps {
  rating: number;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function RatingBadge({ rating, showLabel = true, size = 'md' }: RatingBadgeProps) {
  if (!rating || rating < 800) return null;

  const color = getRatingColor(rating);
  const label = getRatingLabel(rating);
  const sizeStyles = {
    sm: { fontSize: '11px', padding: '2px 6px' },
    md: { fontSize: '12px', padding: '3px 8px' },
    lg: { fontSize: '14px', padding: '4px 10px' },
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        backgroundColor: `${color}20`,
        color,
        borderRadius: '4px',
        fontWeight: 600,
        ...sizeStyles[size],
      }}
    >
      {rating}
      {showLabel && <span style={{ fontWeight: 400, opacity: 0.8 }}>{label}</span>}
    </span>
  );
}
