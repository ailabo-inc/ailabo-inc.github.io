// NDS ROM のヘッダーとファイルシステム（NitroFS: FNT + FAT）の読み取り
import { Reader } from './bytes';
import { parseFnt } from './fnt';

export interface NdsHeader {
  title: string;
  gameCode: string;
  makerCode: string;
  fntOffset: number;
  fntSize: number;
  fatOffset: number;
  fatSize: number;
  romSize: number;
}

export interface NdsFile {
  id: number;
  path: string; // 例: "data/map/field.narc"
  offset: number;
  size: number;
}

export interface NdsRom {
  header: NdsHeader;
  files: NdsFile[];
  /** ファイルIDから中身を取り出す（コピーせずに参照を返す） */
  read(file: NdsFile): Uint8Array;
}

export function parseHeader(r: Reader): NdsHeader {
  if (r.length < 0x200) throw new Error('NDS ROMとしては小さすぎます');
  return {
    title: r.ascii(0x00, 12),
    gameCode: r.ascii(0x0c, 4),
    makerCode: r.ascii(0x10, 2),
    fntOffset: r.u32(0x40),
    fntSize: r.u32(0x44),
    fatOffset: r.u32(0x48),
    fatSize: r.u32(0x4c),
    romSize: r.u32(0x80),
  };
}

export function parseNds(bytes: Uint8Array): NdsRom {
  const r = new Reader(bytes);
  const header = parseHeader(r);
  const { fntOffset: fnt, fatOffset: fat, fatSize } = header;
  if (fnt + 8 > r.length || fat + fatSize > r.length) {
    throw new Error('FNT/FATの位置がROMの範囲外です（NDS ROMではない可能性）');
  }

  const fileCount = fatSize / 8;
  const names = parseFnt(r, fnt, fileCount);

  const files: NdsFile[] = [];
  for (let id = 0; id < fileCount; id++) {
    const start = r.u32(fat + id * 8);
    const end = r.u32(fat + id * 8 + 4);
    if (end < start || end > r.length) continue;
    files.push({
      id,
      // 名前のないファイル（オーバーレイ等）はIDで表す
      path: names.get(id) ?? `#overlay/${id.toString().padStart(4, '0')}.bin`,
      offset: start,
      size: end - start,
    });
  }

  return {
    header,
    files,
    read: (f) => bytes.subarray(f.offset, f.offset + f.size),
  };
}
