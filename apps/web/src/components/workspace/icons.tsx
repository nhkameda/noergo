import type { SVGProps } from 'react';

/** Line icons, 24-unit grid, drawn with currentColor. Decorative: the button carries the label. */
function Icon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      <path d={d} />
    </svg>
  );
}

export const IconPlus = () => <Icon d="M12 5v14M5 12h14" />;
export const IconMore = () => <Icon d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth="3" />;
export const IconSearch = () => <Icon d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM21 21l-4.3-4.3" />;
export const IconClose = () => <Icon d="M6 6l12 12M18 6 6 18" />;
export const IconCheck = () => <Icon d="m5 12.5 4.5 4.5L19 7.5" />;
export const IconCalendar = () => <Icon d="M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />;
export const IconLink = () => <Icon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />;
export const IconUndo = () => <Icon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />;
export const IconRedo = () => <Icon d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />;
export const IconClock = () => <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2" />;
export const IconNote = () => <Icon d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />;
export const IconBoard = () => <Icon d="M4 4h5v16H4zM10.5 4h5v10h-5zM17 4h3v13h-3z" />;
export const IconUser = () => <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" />;
