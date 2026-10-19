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
export const IconGlobe = () => <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3.5 9h17M3.5 15h17M12 3c2.3 2.4 3.5 5.4 3.5 9s-1.2 6.6-3.5 9c-2.3-2.4-3.5-5.4-3.5-9s1.2-6.6 3.5-9Z" />;
export const IconLink = () => <Icon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />;
export const IconUndo = () => <Icon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />;
export const IconRedo = () => <Icon d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />;
export const IconClock = () => <Icon d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2" />;
export const IconNote = () => <Icon d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5" />;
export const IconBoard = () => <Icon d="M4 4h5v16H4zM10.5 4h5v10h-5zM17 4h3v13h-3z" />;
export const IconUser = () => <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0" />;

// The maps
export const IconMap = () => <Icon d="M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM5 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM5 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM19 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM6.5 7.5 10 10M17.5 7.5 14 10M6.5 16.5 10 14M17.5 16.5 14 14" />;
export const IconFollow = () => <Icon d="M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8Z" />;
export const IconFit = () => <Icon d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />;
export const IconOrganize = () => <Icon d="M3 12h5M16 5h5M16 12h5M16 19h5M8 12c4 0 4-7 8-7M8 12h8M8 12c4 0 4 7 8 7" />;
export const IconMinus = () => <Icon d="M5 12h14" />;
export const IconEdit = () => <Icon d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />;
export const IconTrash = () => <Icon d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />;
export const IconSwap = () => <Icon d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />;
export const IconLabel = () => <Icon d="M5 6h14M12 6v13" />;
export const IconBrush = () => <Icon d="M14.5 4.5 19.5 9.5 11 18l-5-5 8.5-8.5ZM6 13l-2.5 6.5L10 17M16 7l1-1" />;
export const IconImage = () => <Icon d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9.5h.01" />;
export const IconColumns = () => <Icon d="M4 4h4v16H4zM10 4h4v11h-4zM16 4h4v14h-4z" />;
export const IconCards = () => <Icon d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />;
/** The ends of a size slider: small on the left, large on the right, as on a Mac. */
export const IconSizeSmall = () => <Icon d="M8 8h8v8H8z" />;
export const IconSizeLarge = () => <Icon d="M5 5h14v14H5z" />;

export const SHAPE_ICONS = {
  pill: () => <Icon d="M8 7h8a5 5 0 0 1 0 10H8A5 5 0 0 1 8 7Z" />,
  rounded: () => <Icon d="M6.5 7h11A2.5 2.5 0 0 1 20 9.5v5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 14.5v-5A2.5 2.5 0 0 1 6.5 7Z" />,
  rect: () => <Icon d="M4 7h16v10H4Z" />,
  ellipse: () => <Icon d="M12 17.5c4.7 0 8.5-2.5 8.5-5.5S16.7 6.5 12 6.5 3.5 9 3.5 12s3.8 5.5 8.5 5.5Z" />,
  diamond: () => <Icon d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12Z" />,
  plain: () => <Icon d="M4 19h16M8 15l4-10 4 10M9.5 11.5h5" />,
} as const;

const DOT = 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z';
export const FILL_ICONS = {
  solid: () => <Icon d={DOT} fill="currentColor" />,
  soft: () => <Icon d={DOT} fill="currentColor" fillOpacity="0.3" />,
  outline: () => <Icon d={DOT} />,
} as const;

export const DASH_ICONS = {
  solid: () => <Icon d="M4 12h16" />,
  dashed: () => <Icon d="M4 12h16" strokeDasharray="4 3" strokeLinecap="butt" />,
  dotted: () => <Icon d="M4 12h16" strokeDasharray="0.1 4" />,
} as const;

export const ROUTE_ICONS = {
  curve: () => <Icon d="M4 18c8 0 8-12 16-12" />,
  straight: () => <Icon d="M4 18 20 6" />,
  elbow: () => <Icon d="M4 18h8V6h8" />,
} as const;

export const ARROW_ICONS = {
  none: () => <Icon d="M4 12h16" />,
  end: () => <Icon d="M4 12h15M14 7l5 5-5 5" />,
  start: () => <Icon d="M5 12h15M10 7l-5 5 5 5" />,
  both: () => <Icon d="M5 12h14M10 7l-5 5 5 5M14 7l5 5-5 5" />,
} as const;

export const WidthIcon = ({ w }: { w: number }) => <Icon d="M4 12h16" strokeWidth={w} />;
