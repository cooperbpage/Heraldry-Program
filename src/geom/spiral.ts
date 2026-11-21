import { V, sub, dot, perp, norm, clamp } from './vec';
import { Sample } from './track';

export interface SpiralOut {
  samples: Sample[];
  /** cumulative arc length per sample (0 at entry) */
  cum: number[];
  /** maximum full width allowed at each sample so coils never overlap and the eye stays open */
  maxW: number[];
  /** +1 when the coil turns toward the left normal of the entry tangent */
  turnSign: number;
  eyeR: number;
}

/**
 * A volute that leaves `P` along unit tangent `T` and winds around `C` until its centreline
 * sits at the rim of an open eye of radius `eyeR` (plus the tip's half width).
 *
 * In log-polar form ln r(φ) is a cubic Hermite blend that starts with the slope implied by the
 * entry tangent (so entry is tangent-continuous) and ends as a true logarithmic spiral. Because
 * the radius shrinks monotonically, curvature rises steadily as it winds in.
 */
export function makeSpiral(P: V, T: V, C: V, eyeR: number, turns: number, tipHalf = 1.5): SpiralOut {
  const R0 = sub(P, C);
  const r0 = Math.max(1e-3, Math.hypot(R0[0], R0[1]));
  const rh = norm(R0);
  // which way round: the eye's side of the entry tangent decides
  const side = dot(sub(C, P), perp(T)) >= 0 ? 1 : -1;
  const sigma = side; // +1: φ increases (turning toward perp(T))
  const phi0 = Math.atan2(R0[1], R0[0]);
  const tang = [-rh[1] * sigma, rh[0] * sigma] as V; // direction of increasing σφ at r=const
  const Tt = Math.max(0.12, dot(T, tang));
  const slope0 = dot(T, rh) / Tt; // d ln r / d(σφ)
  const Phi = Math.max(0.25, turns) * 2 * Math.PI;
  const r1 = Math.min(r0 * 0.6, eyeR + tipHalf);
  const rho0 = Math.log(r0), rho1 = Math.log(Math.max(0.5, r1));
  const dr = rho1 - rho0; // negative
  const m0 = clamp((slope0 * Phi) / dr, 0, 6);
  const m1 = 1;
  const g = (u: number) => {
    const u2 = u * u, u3 = u2 * u;
    return -2 * u3 + 3 * u2 + m0 * (u3 - 2 * u2 + u) + m1 * (u3 - u2);
  };
  const N = Math.max(60, Math.ceil(turns * 360));
  const pos: V[] = [];
  const rad: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const r = Math.exp(rho0 + dr * g(u));
    const ph = phi0 + sigma * Phi * u;
    pos.push([C[0] + r * Math.cos(ph), C[1] + r * Math.sin(ph)]);
    rad.push(r);
  }
  const cum = [0];
  for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pos[i][0] - pos[i - 1][0], pos[i][1] - pos[i - 1][1]));
  const samples: Sample[] = [];
  for (let i = 0; i <= N; i++) {
    const a = pos[Math.max(0, i - 1)], b = pos[Math.min(N, i + 1)];
    let t = norm([b[0] - a[0], b[1] - a[1]]);
    if (i === 0) t = T;
    // curvature from three points
    let k = 0;
    if (i > 0 && i < N) {
      const p0 = pos[i - 1], p1 = pos[i], p2 = pos[i + 1];
      const ax = p1[0] - p0[0], ay = p1[1] - p0[1], bx = p2[0] - p1[0], by = p2[1] - p1[1];
      const cr = ax * by - ay * bx;
      const d = Math.hypot(ax, ay) * Math.hypot(bx, by) * Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
      k = d > 0 ? (2 * cr) / d : 0;
    }
    samples.push({ x: pos[i][0], y: pos[i][1], tx: t[0], ty: t[1], k });
  }
  if (N > 1) {
    samples[0].k = samples[1].k;
    samples[N].k = samples[N - 1].k;
  }
  // width limits: the next coil inward is one full turn later
  const per = Math.round(N / Math.max(0.25, turns));
  const maxW: number[] = [];
  for (let i = 0; i <= N; i++) {
    const j = i + per;
    const eyeLim = 1.9 * Math.max(0.5, rad[i] - eyeR);
    const lim = j <= N ? Math.min(eyeLim, 0.86 * (rad[i] - rad[j])) : eyeLim;
    maxW.push(Math.max(1, lim));
  }
  return { samples, cum, maxW, turnSign: side, eyeR };
}
