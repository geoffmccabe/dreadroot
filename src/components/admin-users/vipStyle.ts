// VIP / supporter tier styling: 0 light grey, 1 gold, 2 bright green, 3 bright
// blue — and font grows by tier so supporters stand out.
const VIP_COLOR = ['text-white/50', 'text-amber-400', 'text-green-400', 'text-sky-400'];
const VIP_SIZE = ['text-xs', 'text-sm', 'text-base', 'text-lg'];
const clamp = (l: number) => Math.min(3, Math.max(0, l | 0));
export const vipColor = (l: number) => VIP_COLOR[clamp(l)];
export const vipSize = (l: number) => VIP_SIZE[clamp(l)];
