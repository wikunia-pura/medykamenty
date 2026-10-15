import { useEffect, useRef, useState } from 'react';

// Loading state for skeletons: true at once while `loading`, and held for at
// least `minMs` from when loading started. A fast load still reads as a short,
// deliberate load followed by the content easing in — never a placeholder that
// flashes for a frame, nor content that just pops in as if nothing loaded.
export function useMinimumLoading(loading: boolean, minMs = 250): boolean {
  const startedAt = useRef<number | null>(loading ? Date.now() : null);
  const [holding, setHolding] = useState(loading);
  useEffect(() => {
    if (loading) {
      startedAt.current = Date.now();
      setHolding(true);
      return;
    }
    const left = startedAt.current === null ? 0 : minMs - (Date.now() - startedAt.current);
    if (left <= 0) {
      setHolding(false);
      return;
    }
    const id = window.setTimeout(() => setHolding(false), left);
    return () => window.clearTimeout(id);
  }, [loading, minMs]);
  return loading || holding;
}
