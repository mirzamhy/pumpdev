interface Point {
  x: number;
  y: number;
  z: number;
}

const COUNT = 64;
const RADIUS = 160;
const CENTER = 200;
/** Links join points closer than this on the unit sphere. */
const LINK_DISTANCE = 0.42;
const TONED: Record<number, string> = { 7: "var(--color-danger)", 23: "var(--color-warn)", 41: "var(--color-danger)", 52: "var(--color-accent-soft)" };

/** Evenly spread points (Fibonacci sphere), tilted so the poles do not face the viewer. */
function spherePoints(): Point[] {
  const tilt = 0.5;
  const points: Point[] = [];
  for (let i = 0; i < COUNT; i++) {
    const y = 1 - (i / (COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = i * Math.PI * (3 - Math.sqrt(5));
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    points.push({ x, y: y * Math.cos(tilt) - z * Math.sin(tilt), z: y * Math.sin(tilt) + z * Math.cos(tilt) });
  }
  return points;
}

const POINTS = spherePoints();
const LINKS: [number, number][] = [];
POINTS.forEach((a, i) => {
  for (let j = i + 1; j < POINTS.length; j++) {
    const b = POINTS[j]!;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < LINK_DISTANCE) LINKS.push([i, j]);
  }
});

const sx = (p: Point) => CENTER + p.x * RADIUS;
const sy = (p: Point) => CENTER + p.y * RADIUS;
/** Front points (z > 0) read brighter and bigger. */
const depth = (p: Point) => (p.z + 1) / 2;

/** Decorative wallet-network globe. Pure SVG, no data; rotation stops under reduced motion. */
export function NetworkSphere({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden className={`pointer-events-none select-none ${className}`}>
      <svg viewBox="0 0 400 400" className="h-full w-full overflow-visible">
        <defs>
          <radialGradient id="sphere-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--color-accent-strong)" stopOpacity="0.45" />
            <stop offset="60%" stopColor="var(--color-accent-strong)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--color-accent-strong)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
            <stop offset="35%" stopColor="var(--color-accent)" stopOpacity="0.8" />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={CENTER} cy={CENTER} r={RADIUS * 1.25} fill="url(#sphere-glow)" />
        <ellipse cx={CENTER} cy={CENTER} rx={RADIUS * 1.18} ry={RADIUS * 0.34} fill="none" stroke="var(--color-accent)" strokeOpacity="0.25" transform={`rotate(-18 ${CENTER} ${CENTER})`} />
        <g className="spin-slow" style={{ transformOrigin: `${CENTER}px ${CENTER}px` }}>
          {LINKS.map(([a, b]) => {
            const p = POINTS[a]!;
            const q = POINTS[b]!;
            return (
              <line
                key={`${a}-${b}`}
                x1={sx(p)}
                y1={sy(p)}
                x2={sx(q)}
                y2={sy(q)}
                stroke="var(--color-accent)"
                strokeOpacity={0.12 + 0.35 * Math.min(depth(p), depth(q))}
                strokeWidth={0.8}
              />
            );
          })}
          {POINTS.map((p, i) => {
            const d = depth(p);
            const toned = TONED[i];
            return (
              <circle
                key={i}
                cx={sx(p)}
                cy={sy(p)}
                r={(toned ? 4.5 : 2.2) + d * 2.4}
                fill={toned ?? (d > 0.55 ? "#d9d3ff" : "var(--color-muted)")}
                fillOpacity={0.35 + d * 0.6}
              />
            );
          })}
        </g>
        <circle cx={CENTER} cy={CENTER} r={34} fill="url(#core-glow)" />
        <circle cx={CENTER} cy={CENTER} r={9} fill="#f3f0ff" />
      </svg>
    </div>
  );
}
