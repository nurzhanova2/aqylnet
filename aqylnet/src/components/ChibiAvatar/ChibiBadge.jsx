import ChibiAvatar from './ChibiAvatar';
import { personaLook } from '../../utils/personaLook';

/**
 * ChibiBadge — чиби-аватар в круге с бордером цвета персоны (как во всех
 * макетах): background #10271D, border 2px solid color, overflow hidden,
 * чиби прижат к низу круга.
 *
 * Props:
 *   persona  — объект персоны (look берётся из persona.look или fallback)
 *   size     — внешний диаметр круга в px
 *   color    — цвет бордера (по умолчанию dot персоны)
 *   speaking — активный спикер: зелёное кольцо + glow (по макету simulation)
 *   border   — толщина бордера (по умолчанию 2)
 */
export default function ChibiBadge({ persona, size = 48, color, speaking = false, border = 2 }) {
  const ringColor = speaking ? 'var(--accent, #36C988)' : (color || persona?.dot || '#36C988');
  return (
    <div
      style={{
        flex: `0 0 ${size}px`,
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#10271D',
        border: `${border}px solid ${ringColor}`,
        boxShadow: speaking ? '0 0 0 5px rgba(54,201,136,.16)' : 'none',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      <ChibiAvatar look={personaLook(persona)} label={persona?.name} size={size - border * 2 - 2} speaking={speaking} />
    </div>
  );
}
