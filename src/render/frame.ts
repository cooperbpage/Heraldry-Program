import { FRAME } from '../model/types';

/** Plain shield outline and an original barred helm, drawn over the mantling. */
export function frameArt(ink: string) {
  const s = FRAME.shield;
  const x0 = s.x, x1 = s.x + s.w, y0 = s.y, cx = s.x + s.w / 2, yb = s.y + s.h;
  const shield =
    `<path d="M${x0} ${y0}H${x1}V${y0 + s.h * 0.42}C${x1} ${y0 + s.h * 0.78} ${cx + s.w * 0.18} ${yb - 20} ${cx} ${yb}` +
    `C${cx - s.w * 0.18} ${yb - 20} ${x0} ${y0 + s.h * 0.78} ${x0} ${y0 + s.h * 0.42}Z" fill="#fffdf7" stroke="${ink}" stroke-width="2.4"/>`;
  const h = FRAME.helm;
  const c = h.x;
  const helm = `<g stroke="${ink}" stroke-width="1.8" stroke-linejoin="round">
<path d="M${c - 70} ${s.y + 2}C${c - 60} ${s.y - 22} ${c - 40} ${s.y - 30} ${c} ${s.y - 32}C${c + 40} ${s.y - 30} ${c + 60} ${s.y - 22} ${c + 70} ${s.y + 2}Z" fill="#c9cccd"/>
<path d="M${c - 54} ${s.y - 22}C${c - 62} ${s.y - 70} ${c - 56} ${s.y - 128} ${c} ${s.y - 142}C${c + 56} ${s.y - 128} ${c + 62} ${s.y - 70} ${c + 54} ${s.y - 22}C${c + 30} ${s.y - 14} ${c - 30} ${s.y - 14} ${c - 54} ${s.y - 22}Z" fill="#dfe2e3"/>
<path d="M${c - 34} ${s.y - 98}C${c - 20} ${s.y - 106} ${c + 20} ${s.y - 106} ${c + 34} ${s.y - 98}L${c + 30} ${s.y - 40}C${c + 14} ${s.y - 34} ${c - 14} ${s.y - 34} ${c - 30} ${s.y - 40}Z" fill="#3a3533"/>
${[-22, -11, 0, 11, 22].map((d) => `<path d="M${c + d} ${s.y - 103}C${c + d * 1.06} ${s.y - 80} ${c + d * 1.04} ${s.y - 58} ${c + d * 0.94} ${s.y - 37}" fill="none" stroke="#e8eaea" stroke-width="4.5"/><path d="M${c + d} ${s.y - 103}C${c + d * 1.06} ${s.y - 80} ${c + d * 1.04} ${s.y - 58} ${c + d * 0.94} ${s.y - 37}" fill="none" stroke-width="1"/>`).join('')}
<path d="M${c - 40} ${s.y - 98}C${c - 20} ${s.y - 110} ${c + 20} ${s.y - 110} ${c + 40} ${s.y - 98}" fill="none" stroke-width="3"/>
<path d="M${c - 44} ${s.y - 125}C${c - 36} ${s.y - 132} ${c - 24} ${s.y - 136} ${c - 14} ${s.y - 137}" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.8"/>
</g>`;
  return shield + helm;
}
