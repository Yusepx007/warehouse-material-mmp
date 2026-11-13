import type { CSSProperties, ReactNode } from 'react';

export type IconName =
  | 'activity'
  | 'arrow-right'
  | 'barcode'
  | 'box'
  | 'camera'
  | 'check'
  | 'clipboard'
  | 'close'
  | 'dashboard'
  | 'history'
  | 'info'
  | 'log-out'
  | 'map'
  | 'map-pin'
  | 'menu'
  | 'package'
  | 'printer'
  | 'truck'
  | 'undo'
  | 'users';

interface IconProps {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  className?: string;
}

const paths: Record<IconName, ReactNode> = {
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  'arrow-right': <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  barcode: <><path d="M4 5v14M8 5v14M11 5v14M15 5v14M18 5v14M21 5v14" /></>,
  box: <><path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z" /><path d="m3.5 7.7 8.5 4.4 8.5-4.4M12 12v9" /></>,
  camera: <><path d="M4 7h3l1.5-2h7L17 7h3v12H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2" /><path d="M9 5.5V4h6v1.5M8 10h8M8 14h8" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  dashboard: <><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>,
  history: <><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  'log-out': <><path d="M10 17l5-5-5-5M15 12H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z" /><path d="M9 3v15M15 6v15" /></>,
  'map-pin': <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  package: <><path d="m12 3 9 4.5v9L12 21l-9-4.5v-9L12 3Z" /><path d="m3.5 7.7 8.5 4.4 8.5-4.4M12 12v9M8 5l8 4" /></>,
  printer: <><path d="M7 8V3h10v5M7 17H4V9h16v8h-3" /><path d="M7 14h10v7H7zM17 11h.01" /></>,
  truck: <><path d="M3 6h11v12H3zM14 10h4l3 3v5h-7z" /><circle cx="7.5" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h9a7 7 0 1 1 0 14h-2" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>,
};

export function Icon({ name, size = 18, strokeWidth = 1.8, style, className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0, ...style }}
    >
      {paths[name]}
    </svg>
  );
}
