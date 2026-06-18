// BannerInput — the challenge banner picker. Accepts an UPLOAD (file picker) or a CLIPBOARD PASTE
// (a "Paste" button via navigator.clipboard, or Ctrl/Cmd+V while the widget is focused). Whatever
// comes in is cover-fitted to a 4:1 frame and re-encoded as a small webp data-URL, stored on the
// challenge (in memory for now; uploaded to storage when challenges get saved in Phase 5).
import { useRef, useState } from 'react';

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// Cover-fit (scale to fill, centre-crop) into 1024×256 → webp.
async function toBanner(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const W = 1024, H = 256;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d')!;
    const s = Math.max(W / img.width, H / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    return cv.toDataURL('image/webp', 0.85);
  } finally { URL.revokeObjectURL(url); }
}

const miniBtn: React.CSSProperties = {
  background: 'hsla(220,25%,22%,0.9)', border: '1px solid hsla(210,30%,50%,0.4)', borderRadius: 5,
  color: '#e8eefb', padding: '3px 9px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
};

export function BannerInput({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const ingest = async (blob: Blob) => {
    try { onChange(await toBanner(blob)); setMsg(''); }
    catch { setMsg('Could not read that image'); }
  };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) ingest(f); e.target.value = '';
  };
  const onPasteBtn = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) { ingest(await it.getType(t)); return; }
      }
      setMsg('No image in clipboard');
    } catch { setMsg('Clipboard blocked — use Upload, or focus this box and press Ctrl/⌘+V'); }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find((x) => x.type.startsWith('image/'));
    const f = item?.getAsFile();
    if (f) { ingest(f); e.preventDefault(); }
  };
  return (
    <div tabIndex={0} onPaste={onPaste} style={{ outline: 'none' }}>
      <div style={{
        width: '100%', aspectRatio: '4 / 1', borderRadius: 6, border: '1px solid hsla(210,30%,45%,0.4)',
        overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: value ? `center / cover no-repeat url(${value})` : 'hsla(220,25%,8%,0.9)',
      }}>
        {!value && <span style={{ fontSize: 10, color: '#7e90ad' }}>4×1 — upload or paste</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button" onClick={() => fileRef.current?.click()} style={miniBtn}>Upload</button>
        <button type="button" onClick={onPasteBtn} style={miniBtn}>Paste</button>
        {value && <button type="button" onClick={() => onChange(undefined)} style={{ ...miniBtn, background: '#7a2b2b' }}>Clear</button>}
      </div>
      {msg && <div style={{ fontSize: 10, color: '#ff9b9b', marginTop: 2 }}>{msg}</div>}
      <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
    </div>
  );
}
