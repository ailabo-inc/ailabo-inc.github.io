// Nintendo DS 標準（Nitro）形式の読み取り：NARC / NCLR / NCGR / NSCR と、形式不明データ用の生タイル表示
import { Reader, magic } from './bytes';
import { parseFnt } from './fnt';

export type Rgba = [number, number, number, number];

export interface Image {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

/** Nitro形式のマジック（ファイル内は逆順で格納されていることが多い）を正規化して返す */
export function nitroKind(b: Uint8Array): string | null {
  if (b.length < 16) return null;
  const m = magic(b);
  const bom = b[4] | (b[5] << 8);
  if (bom !== 0xfeff && bom !== 0xfffe) {
    if (m === 'SDAT') return 'SDAT';
    return null;
  }
  const rev = m.split('').reverse().join('');
  const known = ['NCLR', 'NCGR', 'NSCR', 'NCER', 'NANR', 'NMCR', 'NMAR', 'NARC', 'SDAT', 'BMD0', 'BTX0', 'BCA0', 'BTP0', 'BTA0', 'BMA0', 'BVA0'];
  if (known.includes(m)) return m;
  if (known.includes(rev)) return rev;
  return m;
}

/** 先頭のセクション（magic）の位置を探す */
function findSection(r: Reader, names: string[]): number {
  const headerSize = r.u16(0x0c) || 0x10;
  let p = headerSize;
  while (p + 8 <= r.length) {
    const m = r.ascii(p, 4);
    if (names.includes(m)) return p;
    const size = r.u32(p + 4);
    if (size < 8) break;
    p += size;
  }
  throw new Error(`セクション ${names.join('/')} が見つかりません`);
}

// ---------- NARC（アーカイブ） ----------

export interface NarcEntry {
  index: number;
  name: string;
  data: Uint8Array;
}

export function parseNarc(b: Uint8Array): NarcEntry[] {
  const r = new Reader(b);
  const fat = findSection(r, ['BTAF', 'FATB']);
  const count = r.u16(fat + 8);
  const fnt = findSection(r, ['BTNF', 'FNTB']);
  const img = findSection(r, ['GMIF', 'FIMG']);
  const imgData = img + 8;
  let names = new Map<number, string>();
  try {
    names = parseFnt(r, fnt + 8, count);
  } catch {
    /* 名前なしNARCは多い */
  }
  const entries: NarcEntry[] = [];
  for (let i = 0; i < count; i++) {
    const s = r.u32(fat + 12 + i * 8);
    const e = r.u32(fat + 12 + i * 8 + 4);
    entries.push({
      index: i,
      name: names.get(i) ?? `${i.toString().padStart(4, '0')}.bin`,
      data: b.subarray(imgData + s, imgData + e),
    });
  }
  return entries;
}

// ---------- 色 ----------

export function bgr555(v: number): Rgba {
  const r = v & 0x1f;
  const g = (v >> 5) & 0x1f;
  const b = (v >> 10) & 0x1f;
  return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (b << 3) | (b >> 2), 255];
}

export function readPaletteRaw(b: Uint8Array, offset = 0, count?: number): Rgba[] {
  const n = count ?? Math.floor((b.length - offset) / 2);
  const out: Rgba[] = [];
  for (let i = 0; i < n; i++) out.push(bgr555(b[offset + i * 2] | (b[offset + i * 2 + 1] << 8)));
  return out;
}

export function grayscalePalette(bpp: 4 | 8): Rgba[] {
  const n = bpp === 4 ? 16 : 256;
  return Array.from({ length: n }, (_, i) => {
    const v = Math.round((i / (n - 1)) * 255);
    return [v, v, v, 255] as Rgba;
  });
}

// ---------- NCLR（パレット） ----------

export interface Palette {
  bpp: 4 | 8;
  colors: Rgba[];
}

export function parseNclr(b: Uint8Array): Palette {
  const r = new Reader(b);
  const s = findSection(r, ['TTLP', 'PLTT']);
  const depth = r.u16(s + 8);
  const dataSize = r.u32(s + 0x10);
  const dataOff = s + 8 + r.u32(s + 0x14);
  const size = Math.min(dataSize, b.length - dataOff);
  return { bpp: depth === 4 ? 8 : 4, colors: readPaletteRaw(b, dataOff, Math.floor(size / 2)) };
}

// ---------- NCGR（タイル画像） ----------

export interface Tiles {
  bpp: 4 | 8;
  tilesX: number; // 0 = 指定なし
  tilesY: number;
  tiled: boolean;
  data: Uint8Array;
}

export function parseNcgr(b: Uint8Array): Tiles {
  const r = new Reader(b);
  const s = findSection(r, ['RAHC', 'CHAR']);
  const ty = r.u16(s + 8);
  const tx = r.u16(s + 0x0a);
  const depth = r.u32(s + 0x0c);
  const linear = (r.u32(s + 0x14) & 0xff) === 1;
  const dataSize = r.u32(s + 0x18);
  const dataOff = s + 8 + r.u32(s + 0x1c);
  return {
    bpp: depth === 4 ? 8 : 4,
    tilesX: tx === 0xffff ? 0 : tx,
    tilesY: ty === 0xffff ? 0 : ty,
    tiled: !linear,
    data: b.subarray(dataOff, dataOff + dataSize),
  };
}

/** 1タイル（8x8）あたりのバイト数 */
const tileBytes = (bpp: 4 | 8) => (bpp === 4 ? 32 : 64);

function pixelIndex(data: Uint8Array, bpp: 4 | 8, i: number): number {
  if (bpp === 8) return data[i] ?? 0;
  const v = data[i >> 1] ?? 0;
  return i & 1 ? v >> 4 : v & 0xf;
}

/** タイル列を画像にする。形式不明データの目視解析にも使う */
export function renderTiles(
  data: Uint8Array,
  bpp: 4 | 8,
  palette: Rgba[],
  tilesWide: number,
  opts: { tiled?: boolean; paletteBank?: number; transparent0?: boolean } = {},
): Image {
  const tiled = opts.tiled ?? true;
  const bank = (opts.paletteBank ?? 0) * (bpp === 4 ? 16 : 0);
  const totalPx = (data.length * 8) / bpp;
  const tiles = Math.max(1, Math.ceil(totalPx / 64));
  const tw = Math.max(1, Math.min(tilesWide, tiles));
  const th = Math.ceil(tiles / tw);
  const width = tw * 8;
  const height = th * 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const perTile = tileBytes(bpp);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let src: number;
      if (tiled) {
        const t = Math.floor(y / 8) * tw + Math.floor(x / 8);
        src = (t * perTile * 8) / bpp + (y % 8) * 8 + (x % 8);
      } else {
        src = y * width + x;
      }
      if (src >= totalPx) continue;
      const idx = pixelIndex(data, bpp, src);
      const c = palette[bank + idx] ?? palette[idx] ?? [255, 0, 255, 255];
      const o = (y * width + x) * 4;
      rgba[o] = c[0];
      rgba[o + 1] = c[1];
      rgba[o + 2] = c[2];
      rgba[o + 3] = opts.transparent0 && idx === 0 ? 0 : 255;
    }
  }
  return { width, height, rgba };
}

// ---------- NSCR（タイルマップ） ----------

export interface Screen {
  width: number; // px
  height: number;
  entries: Uint16Array;
}

export function parseNscr(b: Uint8Array): Screen {
  const r = new Reader(b);
  const s = findSection(r, ['NRCS', 'SCRN']);
  const width = r.u16(s + 8);
  const height = r.u16(s + 0x0a);
  const size = r.u32(s + 0x10);
  const entries = new Uint16Array(size / 2);
  for (let i = 0; i < entries.length; i++) entries[i] = r.u16(s + 0x14 + i * 2);
  return { width, height, entries };
}

export function renderScreen(scr: Screen, tiles: Tiles, palette: Rgba[]): Image {
  const { width, height } = scr;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const perTile = tileBytes(tiles.bpp);
  const cols = width / 8;
  for (let i = 0; i < scr.entries.length; i++) {
    const e = scr.entries[i];
    const tile = e & 0x3ff;
    const hf = (e >> 10) & 1;
    const vf = (e >> 11) & 1;
    const pal = tiles.bpp === 4 ? (e >> 12) * 16 : 0;
    const bx = (i % cols) * 8;
    const by = Math.floor(i / cols) * 8;
    if (by >= height) break;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const sx = hf ? 7 - x : x;
        const sy = vf ? 7 - y : y;
        const idx = pixelIndex(tiles.data, tiles.bpp, (tile * perTile * 8) / tiles.bpp + sy * 8 + sx);
        const c = palette[pal + idx] ?? [255, 0, 255, 255];
        const o = ((by + y) * width + bx + x) * 4;
        rgba[o] = c[0];
        rgba[o + 1] = c[1];
        rgba[o + 2] = c[2];
        rgba[o + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}
