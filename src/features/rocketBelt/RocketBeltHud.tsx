// Rocket Belt burst gauge — purple inverted triangles, one per 4 bursts, sitting to the
// right of the orange jet-boost triangles in the HUD. Each triangle is split into 4
// side-by-side sections (25/50/75/100%); a charged burst is deep purple, a spent one turns
// much brighter purple — so the bar reads like hearts filling, but per-quarter. One burst =
// one 0.25s forward zoom (Shift+E). Reads the rocketBelt store directly (no prop threading); only
// renders when a belt is equipped (max > 0).
import { useRocketBeltCharges } from '@/config/rocketBelt';

const BURSTS_PER_TRIANGLE = 4;
const FILLED = '#9333ea'; // deep purple — a charged 0.25s burst
const EMPTY = '#e9d5ff';  // much brighter purple — spent

export function RocketBeltHud({ className }: { className?: string }) {
  const { available, max } = useRocketBeltCharges();
  if (max <= 0) return null;
  const triangles = Math.ceil(max / BURSTS_PER_TRIANGLE);
  return (
    <div
      className={`flex items-center gap-0.5 ${className ?? ''}`}
      title={`Rocket Belt — ${available}/${max} bursts (Shift+E to zoom forward)`}
    >
      {Array.from({ length: triangles }).map((_, t) => {
        // How many of THIS triangle's 4 sections are still charged (fill left→right).
        const charged = Math.max(0, Math.min(BURSTS_PER_TRIANGLE, available - t * BURSTS_PER_TRIANGLE));
        const clipId = `rb-tri-${t}`;
        return (
          <svg
            key={t}
            width="16"
            height="13"
            viewBox="0 0 20 16"
            className="drop-shadow-[0_0_2px_rgba(168,85,247,0.6)]"
          >
            <defs>
              <clipPath id={clipId}>
                {/* Inverted triangle (pointing down), same silhouette as the jets */}
                <polygon points="10,16 0,0 20,0" />
              </clipPath>
            </defs>
            <g clipPath={`url(#${clipId})`}>
              {[0, 1, 2, 3].map((s) => (
                <rect key={s} x={s * 5} y={0} width={5} height={16} fill={s < charged ? FILLED : EMPTY} />
              ))}
            </g>
            <polygon points="10,16 0,0 20,0" fill="none" stroke="#a855f7" strokeWidth="1" />
          </svg>
        );
      })}
    </div>
  );
}
