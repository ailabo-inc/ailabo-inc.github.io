// NitroFS のファイル名テーブル（NDS本体とNARCで共通の形式）
import type { Reader } from './bytes';

/** base: FNT先頭の絶対位置。戻り値: ファイルID → パス */
export function parseFnt(r: Reader, base: number, maxFiles: number): Map<number, string> {
  const names = new Map<number, string>();
  const dirCount = r.u16(base + 6);
  if (dirCount === 0 || dirCount > 4096) return names;
  // 名前なしNARCは先頭エントリのサブテーブル位置がメインテーブル内を指す
  if (r.u32(base) < dirCount * 8) return names;
  const walk = (dirId: number, prefix: string, depth: number) => {
    if (depth > 64) throw new Error('FNTのディレクトリ階層が深すぎます');
    const entry = base + (dirId & 0x0fff) * 8;
    let p = base + r.u32(entry);
    let fileId = r.u16(entry + 4);
    for (;;) {
      if (p >= r.length) throw new Error('FNTが範囲外です');
      const len = r.u8(p++);
      if (len === 0) break;
      const nameLen = len & 0x7f;
      const name = r.ascii(p, nameLen);
      p += nameLen;
      if (len & 0x80) {
        const subId = r.u16(p);
        p += 2;
        walk(subId, prefix + name + '/', depth + 1);
      } else {
        if (fileId < maxFiles) names.set(fileId, prefix + name);
        fileId++;
      }
    }
  };
  walk(0xf000, '', 0);
  return names;
}
