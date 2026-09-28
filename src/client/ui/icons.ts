// Iconos SVG en línea (sin dependencias).
const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  hierro: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M4 16l4-9 6-2 6 7-3 7-9 1z" fill="#8a6f5c"/><path d="M8 7l6-2 2 5-5 3z" fill="#d0703a"/><path d="M11 13l5-3 4 2-3 7z" fill="#a95a2e"/><circle cx="12" cy="8" r="1" fill="#ffd1a8"/></svg>`,
  cobre: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M3 17l5-10 5 1 7 5-4 7H6z" fill="#6b746d"/><path d="M8 7l5 1-2 6-4-1z" fill="#3fbf9a"/><path d="M13 8l7 5-5 2-4-1z" fill="#2c9579"/><circle cx="10" cy="9" r="1" fill="#c8ffee"/></svg>`,
  silicio: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 20l2-12 3 12z" fill="#7cc4ec"/><path d="M11 20l3-16 3 16z" fill="#b8e6ff"/><path d="M15 20l3-9 2 9z" fill="#6fb3dd"/><path d="M14 4l1 6" stroke="#fff" stroke-width="1"/></svg>`,
  chatarra: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="3" y="13" width="11" height="4" rx="1" transform="rotate(-12 8 15)" fill="#8b959a"/><rect x="9" y="9" width="10" height="4" rx="1" transform="rotate(18 14 11)" fill="#b5532c"/><circle cx="16" cy="17" r="3" stroke="#6f797e" stroke-width="2" fill="none"/></svg>`,
  cosecha: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M12 22V9" stroke="#a88a2e" stroke-width="2"/><ellipse cx="12" cy="6" rx="2.6" ry="4" fill="#f0cf52"/><ellipse cx="8.5" cy="11" rx="2.2" ry="3.4" fill="#e6c34f" transform="rotate(-30 8.5 11)"/><ellipse cx="15.5" cy="11" rx="2.2" ry="3.4" fill="#e6c34f" transform="rotate(30 15.5 11)"/><path d="M6 17c3 0 5 1 6 3 1-2 3-3 6-3" stroke="#8fd14f" stroke-width="1.6" fill="none"/></svg>`,
  granjero: svg('<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><path d="M7 8l3 2M17 8l-3 2"/><rect x="9" y="9" width="6" height="5" rx="1.5"/><path d="M12 14v3M10 20l2-3 2 3"/>'),
  constructor: svg('<rect x="3" y="15" width="10" height="5" rx="1.5"/><path d="M8 15v-4l6-5 5 3M19 9v4"/><path d="M17 13h4"/>'),
  hacker: svg('<ellipse cx="12" cy="13" rx="8" ry="4"/><path d="M14 9l2-5 3-1"/><path d="M9 13h3"/><circle cx="19" cy="3" r="1" fill="currentColor"/>'),
  aspersor: svg('<rect x="7" y="15" width="10" height="6" rx="1.5"/><path d="M12 15V8M7 5h10"/><path d="M5 3c-1 2 0 3 0 3M19 3c1 2 0 3 0 3M12 2v2"/>'),
  dron: svg('<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M7 8l3 2M17 8l-3 2M7 16l3-2M17 16l-3-2"/><rect x="9" y="9" width="6" height="6" rx="1.5"/>'),
  explorador: svg('<ellipse cx="12" cy="12" rx="8" ry="4"/><circle cx="12" cy="12" r="2"/><path d="M12 8V3"/>'),
  minero: svg('<rect x="3" y="12" width="13" height="6" rx="2"/><path d="M6 12V9h6v3M16 14l5-2v4z"/>'),
  code: svg('<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12"/>'),
  play: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>`,
  stop: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>`,
  book: svg('<path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z"/><path d="M4 19V5M8 7h7"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 01-8 0z"/><path d="M8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8 20h8"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  grid: svg('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  history: svg('<path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.5"/><path d="M3 4v4h4M12 8v4l3 2"/>'),
  file: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  bolt: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor"/></svg>`,
  box: svg('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  pin: svg('<path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  fast: `<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M3 6l8 6-8 6zM12 6l8 6-8 6z" fill="currentColor"/></svg>`,
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  warn: svg('<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>'),
};

export function resIcon(k: string): string {
  return (ICON as Record<string, string>)[k] ?? '';
}
