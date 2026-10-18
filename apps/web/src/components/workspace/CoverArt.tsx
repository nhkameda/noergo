'use client';

import { coverBox } from './cover';
import type { CoverLook } from './cover-client';

/** A cover in its 3:1 frame. Decorative: the column's title is always next to it. */
export function CoverArt({ look, className = '' }: { look: CoverLook; className?: string }) {
  const box = coverBox(look);
  return (
    <div className={`w-cover ${className}`} style={look.bg ? { background: look.bg } : undefined}>
      <img src={look.src} alt="" draggable={false} decoding="async" style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }} />
    </div>
  );
}
