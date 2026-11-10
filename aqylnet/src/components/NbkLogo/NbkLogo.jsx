/**
 * NbkLogo — знак AqylNet: круглый стол из восьми участников-узлов с золотой
 * искрой в центре. Источник правды — src/assets/logo/*.svg; здесь та же
 * геометрия инлайном, чтобы знак можно было красить и масштабировать из CSS
 * без загрузки файла.
 *
 * Вариант для светлого фона — aqylnet-logo-round-table-light.svg,
 * иконка приложения (скруглённый квадрат) — public/favicon.svg.
 */

// Восемь мест за столом: равномерно по окружности r = 22 от центра 32,32.
const SEATS = [
  [32, 10],
  [47.56, 16.44],
  [54, 32],
  [47.56, 47.56],
  [32, 54],
  [16.44, 47.56],
  [10, 32],
  [16.44, 16.44],
];

export default function NbkLogo({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="AqylNet"
    >
      {/*
        Знак нарисован под 64px, а в шапке живёт на 22px — при обычном
        масштабировании обводка стола стала бы тоньше device-пикселя и
        пропала. vector-effect держит её неизменной на любом размере.
      */}
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="none"
        stroke="#1F4A36"
        strokeWidth="1.2"
        vectorEffect="non-scaling-stroke"
      />
      <g fill="#36C988">
        {SEATS.map(([cx, cy]) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" />
        ))}
      </g>
      <path
        d="M32 21 L34.8 29.2 L43 32 L34.8 34.8 L32 43 L29.2 34.8 L21 32 L29.2 29.2 Z"
        fill="#C59A3D"
      />
    </svg>
  );
}
