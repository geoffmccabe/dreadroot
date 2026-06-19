// Browser util: decode an image (data URL or /public path) into a GrayGrid resampled
// to F columns, with background/structure detection. Used by the live preview.
import type { GrayGrid } from './imageToFortress';

const imgCache = new Map<string, HTMLImageElement>();

export function loadImageEl(src: string): Promise<HTMLImageElement> {
  const cached = imgCache.get(src);
  if (cached?.complete && cached.naturalWidth) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { imgCache.set(src, img); resolve(img); };
    img.onerror = reject;
    img.src = src;
  });
}

export function imageToGrayGrid(img: HTMLImageElement, F: number): GrayGrid {
  const H = Math.max(1, Math.round(F * (img.naturalHeight / img.naturalWidth)));
  const canvas = document.createElement('canvas');
  canvas.width = F;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.clearRect(0, 0, F, H);
  ctx.drawImage(img, 0, 0, F, H);
  const d = ctx.getImageData(0, 0, F, H).data;

  // Background detection: prefer alpha if it varies, else decide by corner brightness.
  let alphaVaries = false;
  for (let i = 3; i < d.length; i += 4) { if (d[i] < 200) { alphaVaries = true; break; } }
  const cornerOffsets = [0, F - 1, (H - 1) * F, (H - 1) * F + (F - 1)].map((p) => p * 4);
  const cornerAvg = cornerOffsets.reduce((a, o) => a + (d[o] + d[o + 1] + d[o + 2]) / 765, 0) / 4;
  const bgIsDark = cornerAvg < 0.5; // if the background is dark, structure = the bright pixels

  const gray: number[][] = [];
  const present: boolean[][] = [];
  for (let r = 0; r < H; r++) {
    gray[r] = [];
    present[r] = [];
    for (let c = 0; c < F; c++) {
      const o = (r * F + c) * 4;
      const b = (d[o] + d[o + 1] + d[o + 2]) / 765;
      const a = d[o + 3] / 255;
      gray[r][c] = b;
      present[r][c] = alphaVaries ? a > 0.5 : (bgIsDark ? b > 0.30 : b < 0.70);
    }
  }
  return { gray, present, W: F, H };
}
