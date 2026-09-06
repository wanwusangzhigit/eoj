import { useEffect, useState } from 'react';

// Provides a periodically-updated "now" timestamp so components can derive
// live status (e.g. contest running/ended) without calling Date.now() during
// render, which would make the render impure.
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
