// VIP / supporter tier styling. The COLORS live in CSS vars (--vip-0..3 in
// index.css) so they can be tuned in one place and reused app-wide (the User
// Panel corner accent + the player-name colors in Admin → Users both read
// them). Level 0 = basic (grey), 1 = gold, 2 = bright green, 3 = bright blue.
// Font grows by tier so supporters stand out.
const VIP_SIZE = ['text-xs', 'text-sm', 'text-base', 'text-lg'];
// Name-prefix shown before the player's name: basic = "User", supporters = "VIP1/2/3".
const VIP_LABEL = ['User', 'VIP1', 'VIP2', 'VIP3'];
const clamp = (l: number) => Math.min(3, Math.max(0, l | 0));
// Color VALUE for inline styles / borders, e.g. `var(--vip-2)`.
export const vipColorVar = (l: number) => `var(--vip-${clamp(l)})`;
export const vipSize = (l: number) => VIP_SIZE[clamp(l)];
export const vipLabel = (l: number) => VIP_LABEL[clamp(l)];
