// Flat device art for Architecture nodes.
//
// A component may name one of these instead of sitting on a plain card:
//
//   { "id": "laptop", "pictogram": "laptop", "label": "Laptop", "pos": [x, y], "size": [120, 80] }
//
// The art is drawn on a 120x80 stage (phone and tablet are narrower), fitted
// into the node box without distortion, and the label is drawn below the box.
// Colours are mid-tones so the same art reads on the light and the dark theme.

const BODY = '#9aafc4';
const BODY_LIGHT = '#bdcbd9';
const BODY_DARK = '#6d8298';
const GLASS = '#22303f';
const SCREEN = '#33526e';
const GLOW = '#7dd3fc';
const AMBER = '#e2a03f';

const ART = {
  laptop: {
    w: 120,
    h: 80,
    body: `
      <path d="M24 14h72a5 5 0 0 1 5 5v43H19V19a5 5 0 0 1 5-5z" fill="${BODY}"/>
      <rect x="23" y="18" width="74" height="40" rx="2" fill="${GLASS}"/>
      <rect x="27" y="22" width="66" height="32" rx="1.5" fill="${SCREEN}"/>
      <path d="M27 22h66v11H27z" fill="${GLOW}" opacity=".22"/>
      <path d="M10 62h100l9 9H1z" fill="${BODY_LIGHT}"/>
      <path d="M10 62h100l2 2.4H8z" fill="${BODY_DARK}" opacity=".8"/>
      <rect x="52" y="64" width="16" height="3.6" rx="1.8" fill="${BODY_DARK}" opacity=".7"/>`,
  },
  display: {
    w: 120,
    h: 80,
    body: `
      <rect x="6" y="8" width="108" height="56" rx="4" fill="${BODY}"/>
      <rect x="10" y="12" width="100" height="48" rx="2" fill="${GLASS}"/>
      <rect x="14" y="16" width="92" height="40" rx="1.5" fill="${SCREEN}"/>
      <path d="M14 16h92v13H14z" fill="${GLOW}" opacity=".2"/>
      <rect x="54" y="64" width="12" height="8" fill="${BODY_DARK}"/>
      <rect x="38" y="72" width="44" height="4" rx="2" fill="${BODY}"/>`,
  },
  projector: {
    w: 120,
    h: 80,
    body: `
      <rect x="16" y="26" width="60" height="30" rx="7" fill="${BODY}"/>
      <circle cx="34" cy="41" r="8.5" fill="${GLASS}"/>
      <circle cx="34" cy="41" r="5" fill="${SCREEN}"/>
      <circle cx="32.4" cy="39.4" r="1.8" fill="${GLOW}" opacity=".85"/>
      <rect x="48" y="31" width="22" height="4" rx="2" fill="${BODY_DARK}" opacity=".8"/>
      <rect x="48" y="39" width="22" height="4" rx="2" fill="${BODY_DARK}" opacity=".8"/>
      <rect x="48" y="47" width="14" height="4" rx="2" fill="${BODY_DARK}" opacity=".8"/>
      <path d="M76 29 118 13v56L76 53z" fill="${GLOW}" opacity=".16"/>`,
  },
  camera: {
    w: 120,
    h: 80,
    body: `
      <rect x="24" y="26" width="72" height="28" rx="6" fill="${BODY}"/>
      <rect x="24" y="26" width="18" height="28" rx="6" fill="${BODY_DARK}" opacity=".55"/>
      <circle cx="46" cy="40" r="10.5" fill="${GLASS}"/>
      <circle cx="46" cy="40" r="6.5" fill="${SCREEN}"/>
      <circle cx="43.4" cy="37.4" r="2" fill="${GLOW}" opacity=".8"/>
      <rect x="56" y="54" width="10" height="8" fill="${BODY_DARK}" opacity=".7"/>
      <rect x="42" y="62" width="38" height="4.5" rx="2.2" fill="${BODY}"/>`,
  },
  'ptz-camera': {
    w: 120,
    h: 80,
    body: `
      <rect x="46" y="8" width="28" height="6" rx="3" fill="${BODY_DARK}"/>
      <rect x="57" y="13" width="6" height="12" fill="${BODY_DARK}" opacity=".8"/>
      <path d="M32 46a28 22 0 0 1 56 0z" fill="${BODY}"/>
      <circle cx="60" cy="44" r="15" fill="${GLASS}"/>
      <circle cx="60" cy="44" r="8" fill="${SCREEN}"/>
      <circle cx="56.4" cy="40.4" r="2.4" fill="${GLOW}" opacity=".8"/>
      <rect x="28" y="46" width="64" height="5" rx="2.5" fill="${BODY_DARK}"/>
      <rect x="38" y="51" width="44" height="4" rx="2" fill="${BODY}" opacity=".8"/>`,
  },
  'document-camera': {
    w: 120,
    h: 80,
    body: `
      <rect x="56" y="66" width="44" height="6" rx="2" fill="${BODY_LIGHT}"/>
      <rect x="18" y="59" width="38" height="7" rx="1" fill="#eef2f6" opacity=".92"/>
      <rect x="76" y="26" width="7" height="42" rx="3.5" fill="${BODY_DARK}"/>
      <rect x="24" y="13" width="60" height="14" rx="5" fill="${BODY}"/>
      <rect x="34" y="27" width="16" height="4" rx="2" fill="${BODY_DARK}" opacity=".75"/>
      <circle cx="42" cy="35" r="4.5" fill="${GLASS}"/>
      <circle cx="42" cy="35" r="2.2" fill="${GLOW}" opacity=".85"/>
      <path d="M42 41 36 57" stroke="${GLOW}" stroke-width="1.4" opacity=".25"/>`,
  },
  microphone: {
    w: 120,
    h: 80,
    body: `
      <rect x="52" y="10" width="16" height="28" rx="8" fill="${BODY}"/>
      <rect x="55.5" y="15" width="9" height="18" rx="4.5" fill="${BODY_DARK}" opacity=".55"/>
      <rect x="54" y="38" width="12" height="30" rx="4" fill="${BODY_DARK}"/>
      <circle cx="60" cy="72" r="4.5" fill="${GLASS}" opacity=".8"/>`,
  },
  speaker: {
    w: 120,
    h: 80,
    body: `
      <circle cx="60" cy="40" r="27" fill="${BODY_LIGHT}"/>
      <circle cx="60" cy="40" r="21" fill="${BODY}"/>
      <circle cx="60" cy="40" r="14" fill="${BODY_DARK}"/>
      <circle cx="60" cy="40" r="5" fill="${GLASS}"/>
      <circle cx="42" cy="22" r="1.8" fill="${GLASS}" opacity=".45"/>
      <circle cx="78" cy="22" r="1.8" fill="${GLASS}" opacity=".45"/>
      <circle cx="42" cy="58" r="1.8" fill="${GLASS}" opacity=".45"/>
      <circle cx="78" cy="58" r="1.8" fill="${GLASS}" opacity=".45"/>`,
  },
  pc: {
    w: 120,
    h: 80,
    body: `
      <rect x="40" y="6" width="40" height="68" rx="4" fill="${BODY}"/>
      <rect x="45" y="11" width="30" height="9" rx="2" fill="${BODY_DARK}" opacity=".75"/>
      <circle cx="49" cy="28" r="2.4" fill="${GLOW}"/>
      <rect x="45" y="36" width="30" height="3" rx="1.5" fill="${BODY_DARK}" opacity=".55"/>
      <rect x="45" y="42" width="30" height="3" rx="1.5" fill="${BODY_DARK}" opacity=".55"/>
      <rect x="45" y="56" width="30" height="11" rx="2" fill="${BODY_DARK}" opacity=".45"/>`,
  },
  server: {
    w: 120,
    h: 80,
    body: `
      <rect x="14" y="24" width="92" height="32" rx="4" fill="${BODY}"/>
      <rect x="20" y="29" width="16" height="11" rx="2" fill="${BODY_DARK}" opacity=".8"/>
      <rect x="40" y="29" width="16" height="11" rx="2" fill="${BODY_DARK}" opacity=".8"/>
      <circle cx="66" cy="34" r="2" fill="${GLOW}"/>
      <circle cx="72" cy="34" r="2" fill="${GLOW}"/>
      <circle cx="78" cy="34" r="2" fill="${AMBER}"/>
      <rect x="86" y="29" width="14" height="11" rx="2" fill="${BODY_DARK}" opacity=".8"/>
      <rect x="20" y="45" width="80" height="2" fill="${BODY_DARK}" opacity=".5"/>`,
  },
  'network-switch': {
    w: 120,
    h: 80,
    body: `
      <rect x="10" y="28" width="100" height="28" rx="3" fill="${BODY}"/>
      <rect x="10" y="28" width="100" height="5" rx="2" fill="${BODY_DARK}" opacity=".55"/>
      ${Array.from({ length: 9 }, (_, i) => `<rect x="${18 + i * 10}" y="41" width="6" height="8" rx="1" fill="${GLASS}"/>`).join('')}
      <circle cx="104" cy="35" r="1.8" fill="${GLOW}"/>
      <circle cx="98" cy="35" r="1.8" fill="${AMBER}"/>`,
  },
  cloud: {
    w: 120,
    h: 80,
    body: `
      <path d="M40 60h44a13 13 0 0 0 2-25.8A17 17 0 0 0 54 25a14 14 0 0 0-16 13.6A11 11 0 0 0 40 60z"
        fill="${BODY_LIGHT}" stroke="${BODY_DARK}" stroke-width="2.4"/>
      <circle cx="52" cy="42" r="2.2" fill="${SCREEN}"/>
      <circle cx="62" cy="42" r="2.2" fill="${SCREEN}"/>
      <circle cx="72" cy="42" r="2.2" fill="${SCREEN}"/>`,
  },
  'touch-panel': {
    w: 120,
    h: 80,
    body: `
      <rect x="34" y="6" width="52" height="62" rx="4" fill="${BODY}"/>
      <rect x="38" y="10" width="44" height="50" rx="2" fill="${GLASS}"/>
      <rect x="42" y="14" width="36" height="42" rx="1.5" fill="${SCREEN}"/>
      <path d="M42 14h36v12H42z" fill="${GLOW}" opacity=".18"/>
      <circle cx="60" cy="64" r="2" fill="${BODY_DARK}"/>
      <rect x="50" y="68" width="20" height="4" rx="2" fill="${BODY_DARK}" opacity=".7"/>`,
  },
  tablet: {
    w: 120,
    h: 80,
    body: `
      <rect x="34" y="8" width="52" height="64" rx="6" fill="${BODY}"/>
      <rect x="38" y="15" width="44" height="46" rx="2" fill="${GLASS}"/>
      <rect x="42" y="19" width="36" height="38" rx="1.5" fill="${SCREEN}"/>
      <path d="M42 19h36v11H42z" fill="${GLOW}" opacity=".18"/>
      <circle cx="60" cy="67" r="2.6" fill="${BODY_DARK}"/>`,
  },
  phone: {
    w: 120,
    h: 80,
    body: `
      <rect x="44" y="6" width="32" height="68" rx="7" fill="${BODY}"/>
      <rect x="48" y="14" width="24" height="46" rx="2" fill="${GLASS}"/>
      <rect x="51" y="17" width="18" height="40" rx="1.5" fill="${SCREEN}"/>
      <rect x="55" y="9" width="10" height="2.6" rx="1.3" fill="${BODY_DARK}"/>
      <circle cx="60" cy="67" r="2.6" fill="${BODY_DARK}"/>`,
  },
  rack: {
    w: 120,
    h: 80,
    body: `
      <rect x="24" y="6" width="72" height="68" rx="3" fill="${BODY}"/>
      <rect x="29" y="11" width="62" height="15" rx="2" fill="${BODY_LIGHT}"/>
      <rect x="29" y="30" width="62" height="15" rx="2" fill="${BODY_LIGHT}"/>
      <rect x="29" y="49" width="62" height="15" rx="2" fill="${BODY_LIGHT}"/>
      <circle cx="34" cy="18.5" r="1.8" fill="${GLOW}"/>
      <circle cx="34" cy="37.5" r="1.8" fill="${GLOW}"/>
      <circle cx="34" cy="56.5" r="1.8" fill="${AMBER}"/>
      <rect x="70" y="15" width="18" height="7" rx="1" fill="${BODY_DARK}" opacity=".45"/>
      <rect x="70" y="34" width="18" height="7" rx="1" fill="${BODY_DARK}" opacity=".45"/>
      <rect x="70" y="53" width="18" height="7" rx="1" fill="${BODY_DARK}" opacity=".45"/>`,
  },
  sensor: {
    w: 120,
    h: 80,
    body: `
      <ellipse cx="60" cy="50" rx="22" ry="10" fill="${BODY_DARK}" opacity=".6"/>
      <ellipse cx="60" cy="42" rx="22" ry="13" fill="${BODY}"/>
      <ellipse cx="60" cy="38" rx="22" ry="13" fill="${BODY_LIGHT}"/>
      <circle cx="60" cy="36" r="6" fill="${GLASS}"/>
      <circle cx="60" cy="36" r="2.6" fill="${GLOW}" opacity=".85"/>`,
  },
};

export const PICTOGRAM_NAMES = Object.keys(ART);

export function pictogramAspect(name) {
  const art = ART[name];
  return art ? art.w / art.h : null;
}

// Fit the art inside the node box without distortion. The box stays the routing
// anchor, so connections keep landing on its edges.
export function renderPictogram(name, { x, y, width, height }) {
  const art = ART[name];
  if (!art) return '';
  const scale = Math.min(width / art.w, height / art.h);
  const tx = x + (width - art.w * scale) / 2;
  const ty = y + (height - art.h * scale) / 2;
  return `<g data-pictogram="${name}" aria-hidden="true" transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">${art.body}</g>`;
}
