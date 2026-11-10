/**
 * ChibiAvatar — чиби-человечек по макету chibi.spec (SVG 120×120).
 *
 * Props:
 *   look     — { skin, hair, outfit: '#hex', style: 'short'|'long'|'bob'|'bun'|'spiky', glasses?: boolean }
 *   size     — размер в px (по умолчанию 120)
 *   label    — aria-label (имя персоны)
 *   speaking — активный спикер: лёгкое покачивание + анимированный открытый рот
 *
 * Слои причёсок управляются display, ровно как в спеке:
 *   longD / bobD / bunD / spikyD — только для своего style,
 *   capD — «шапка» волос для всех стилей, кроме spiky.
 */
export default function ChibiAvatar({ look, size = 120, label = 'Аватар персоны', speaking = false }) {
  const l = look || {};
  const s = l.style || 'short';
  const show = (b) => (b ? 'inline' : 'none');
  const skin = l.skin || '#EBC29E';
  const hair = l.hair || '#2A1F1A';
  const outfit = l.outfit || '#174B34';
  const longD = show(s === 'long');
  const bobD = show(s === 'bob');
  const bunD = show(s === 'bun');
  const spikyD = show(s === 'spiky');
  const capD = show(s !== 'spiky');
  const glassesD = show(Boolean(l.glasses));

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={label}
      style={{
        display: 'block',
        animation: speaking ? 'aqChibiBob 1.1s ease-in-out infinite' : 'none',
      }}
    >
      <path display={longD} d="M24 52 Q22 13 60 12 Q98 13 96 52 L101 108 Q60 116 19 108 Z" fill={hair} />
      <circle display={bunD} cx="60" cy="14" r="13" fill={hair} />
      <path d="M27 120 Q27 90 60 87 Q93 90 93 120 Z" fill={outfit} />
      <path d="M50 89 L60 101 L70 89 Z" fill="#F2EEE3" />
      <circle cx="26" cy="59" r="6" fill={skin} />
      <circle cx="94" cy="59" r="6" fill={skin} />
      <circle cx="60" cy="54" r="34" fill={skin} />
      <path display={bobD} d="M26 50 Q19 84 36 91 L41 58 Z M94 50 Q101 84 84 91 L79 58 Z" fill={hair} />
      <path display={capD} d="M25 57 Q19 15 60 14 Q101 15 95 57 Q90 38 74 32 Q63 44 40 40 Q30 44 25 57 Z" fill={hair} />
      <path display={spikyD} d="M25 57 Q19 15 60 14 Q101 15 95 57 L88 40 L82 49 L74 36 L66 47 L58 34 L50 47 L42 36 L36 49 L30 40 Z" fill={hair} />
      <path display={longD} d="M26 52 Q23 82 30 98 L37 60 Z M94 52 Q97 82 90 98 L83 60 Z" fill={hair} />
      <ellipse cx="46" cy="59" rx="5" ry="6.5" fill="#1D1B22" />
      <ellipse cx="74" cy="59" rx="5" ry="6.5" fill="#1D1B22" />
      <circle cx="47.6" cy="56.4" r="1.9" fill="#FFFFFF" />
      <circle cx="75.6" cy="56.4" r="1.9" fill="#FFFFFF" />
      <ellipse cx="38" cy="69" rx="5" ry="3" fill="#F08F8F" opacity="0.5" />
      <ellipse cx="82" cy="69" rx="5" ry="3" fill="#F08F8F" opacity="0.5" />
      {/* рот: говорит — открытый анимированный эллипс, молчит — улыбка */}
      {speaking ? (
        <ellipse cx="60" cy="72" rx="5.5" ry="4" fill="#5A2E2A">
          <animate attributeName="ry" values="4;1.8;4" dur="0.7s" repeatCount="indefinite" />
        </ellipse>
      ) : (
        <path d="M55 71 Q60 75 65 71" stroke="#5A2E2A" strokeWidth="2" fill="none" strokeLinecap="round" />
      )}
      <g display={glassesD} stroke="#1D1B22" strokeWidth="2" fill="none">
        <circle cx="46" cy="59" r="9" />
        <circle cx="74" cy="59" r="9" />
        <path d="M55 59 L65 59" />
      </g>
    </svg>
  );
}
