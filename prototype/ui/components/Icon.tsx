const CIRCLE = 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z';

const PATHS = {
  case: 'M6 5h12v15H6z M9 5V3h6v2 M9 10h6 M9 14h6',
  people:
    'M4 20v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2 M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6z ' +
    'M17 5a3 3 0 0 1 0 6 M20 20v-2a4 4 0 0 0-2-3.5',
  chart: 'M4 20h16 M7 16v-5 M12 16V5 M17 16v-8',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  clock: `${CIRCLE} M12 7v5l3 2`,
  question: `${CIRCLE} M9.6 9.4a2.5 2.5 0 1 1 3.7 2.2c-.8.5-1.3 1-1.3 1.9 M12 17h.01`,
  alert: 'M12 4l9 16H3z M12 10v4 M12 17h.01',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  minus: 'M6 12h12',
  info: `${CIRCLE} M12 11v5 M12 8h.01`,
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7 M20 5v6h-6',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
  chevron: 'M6 9l6 6 6-6',
  document: 'M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5',
  finance: 'M4 7h16v10H4z M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z M7 10v4 M17 10v4',
  medical: 'M5 5h14v14H5z M12 8.5v7 M8.5 12h7',
  shield: 'M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  send: 'M4 12l16-7-6 16-3-6z',
  repeat: 'M4 9h13l-3-3 M20 15H7l3 3',
  external: 'M14 5h5v5 M19 5l-8 8 M11 7H6v11h11v-5',
  close: 'M6 6l12 12 M18 6L6 18',
  route: 'M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M8 18h6a4 4 0 0 0 4-4V8',
  message: 'M4 5h16v11H9l-5 4z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M5 20a7 7 0 0 1 14 0',
  plus: 'M12 5v14 M5 12h14',
  calendar: 'M5 6h14v14H5z M5 10h14 M9 4v4 M15 4v4',
  list: 'M9 7h11 M9 12h11 M9 17h11 M4.5 7h.01 M4.5 12h.01 M4.5 17h.01',
  lock: 'M7 11h10v9H7z M9 11V8a3 3 0 0 1 6 0v3',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  /** Розмір у пікселях; типово 20. */
  size?: 16 | 20 | 24 | 28;
}

/** Декоративна лінійна іконка. Зміст завжди дублюється текстом поруч. */
export function Icon({name, size = 20}: IconProps) {
  return (
    <svg
      className={`icon icon--${size}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
