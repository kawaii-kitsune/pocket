const paths = {
  pin: '<path d="m8 3 8 0-1 6 3 3v2H6v-2l3-3-1-6ZM12 14v7"/>',
  collapse: '<path d="M8 3v5H3m18 0h-5V3M3 16h5v5m8 0v-5h5"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  minus: '<path d="M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  play: '<path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h4v14H7zM15 5h4v14h-4z" fill="currentColor" stroke="none"/>',
  previous: '<path d="M5 5v14M19 5 7 12l12 7Z" fill="currentColor"/>',
  next: '<path d="M19 5v14M5 5l12 7-12 7Z" fill="currentColor"/>',
  shuffle: '<path d="m17 3 4 4-4 4M3 17h3c4 0 5-10 9-10h6M3 7h3c1 0 2 1 3 3m4 4c1 2 2 3 3 3h5m-4-4 4 4-4 4"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  repeatOne: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3m8-8 2-1v6"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  volume: '<path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  volumeMute: '<path d="m11 4-6 5H2v6h3l6 5ZM22 9l-6 6m0-6 6 6"/>',
  radio: '<circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4m-8.4 0a6 6 0 0 1 0-8.4m11.3-2.9a10 10 0 0 1 0 14.2m-14.2 0a10 10 0 0 1 0-14.2"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>',
  device: '<rect x="3" y="3" width="18" height="13" rx="2"/><path d="M8 21h8m-4-5v5"/>',
  library: '<path d="M4 4v16M9 4v16m5-15 5-1 3 15-5 1Z"/>',
  queue: '<path d="M4 6h16M4 11h16M4 16h8m4-1 5 3-5 3Z"/>',
  settings: '<path d="m10 3-1 3-3 1-2 3 2 3-1 3 3 3 3-1 3 1 3-3-1-3 2-3-2-3-3-1-1-3Z"/><circle cx="11" cy="11" r="3"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/>',
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.music}</svg>`;
}
export function setIcon(element, name) { element.innerHTML = icon(name); }
export function initializeIcons() { document.querySelectorAll('[data-icon]').forEach(el => setIcon(el, el.dataset.icon)); }
