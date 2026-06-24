// Rocket Belt burst gauge — a small HUD bar showing remaining forward-boost bursts
// (Shift+E). Reads the rocketBelt store directly (no prop threading); only renders when a
// belt is equipped (max > 0). Sky-blue to read as "forward dash", distinct from the
// orange "up" jet-boost triangles it sits beside.
import { useRocketBeltCharges } from '@/config/rocketBelt';

export function RocketBeltHud() {
  const { available, max } = useRocketBeltCharges();
  if (max <= 0) return null;
  const pct = Math.max(0, Math.min(1, available / max));
  return (
    <div
      className="ml-2 flex items-center gap-1"
      title={`Rocket Belt — ${available}/${max} bursts ready (Shift+E to boost forward)`}
    >
      <span className="text-[10px] font-bold text-sky-400 drop-shadow-[0_0_2px_rgba(56,189,248,0.6)]">»</span>
      <div className="relative h-2 w-14 overflow-hidden rounded-sm bg-sky-950/60 ring-1 ring-sky-500/40">
        <div
          className="absolute inset-y-0 left-0 bg-sky-400 transition-[width] duration-150"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
      <span className="text-[9px] font-bold tabular-nums text-sky-300">{available}</span>
    </div>
  );
}
