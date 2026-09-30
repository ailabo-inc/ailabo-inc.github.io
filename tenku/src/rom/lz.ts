// DS BIOS互換の圧縮形式（LZ10 / LZ11）の展開

export function isLz(b: Uint8Array): boolean {
  if (b.length < 4) return false;
  const type = b[0];
  if (type !== 0x10 && type !== 0x11) return false;
  const size = b[1] | (b[2] << 8) | (b[3] << 16);
  // 展開後サイズが圧縮データに対して極端でないかの簡易チェック
  return size > 0 && size <= b.length * 16 && size < 64 * 1024 * 1024;
}

export function decompressLz(src: Uint8Array): Uint8Array {
  const type = src[0];
  let outSize = src[1] | (src[2] << 8) | (src[3] << 16);
  let p = 4;
  if (outSize === 0 && type === 0x11) {
    outSize = src[4] | (src[5] << 8) | (src[6] << 16) | (src[7] << 24);
    p = 8;
  }
  const out = new Uint8Array(outSize);
  let o = 0;
  while (o < outSize) {
    if (p >= src.length) throw new Error('LZデータが途中で終わっています');
    const flags = src[p++];
    for (let bit = 7; bit >= 0 && o < outSize; bit--) {
      if ((flags & (1 << bit)) === 0) {
        out[o++] = src[p++];
        continue;
      }
      let len: number;
      let disp: number;
      if (type === 0x10) {
        const b0 = src[p++];
        const b1 = src[p++];
        len = (b0 >> 4) + 3;
        disp = (((b0 & 0xf) << 8) | b1) + 1;
      } else {
        const b0 = src[p++];
        const ind = b0 >> 4;
        if (ind === 0) {
          const b1 = src[p++];
          const b2 = src[p++];
          len = (((b0 & 0xf) << 4) | (b1 >> 4)) + 0x11;
          disp = (((b1 & 0xf) << 8) | b2) + 1;
        } else if (ind === 1) {
          const b1 = src[p++];
          const b2 = src[p++];
          const b3 = src[p++];
          len = (((b0 & 0xf) << 12) | (b1 << 4) | (b2 >> 4)) + 0x111;
          disp = (((b2 & 0xf) << 8) | b3) + 1;
        } else {
          const b1 = src[p++];
          len = ind + 1;
          disp = (((b0 & 0xf) << 8) | b1) + 1;
        }
      }
      if (disp > o) throw new Error('LZの参照位置が不正です');
      for (let i = 0; i < len && o < outSize; i++, o++) out[o] = out[o - disp];
    }
  }
  return out;
}

/** 圧縮されていそうなら展開、そうでなければそのまま返す */
export function maybeDecompress(b: Uint8Array): { data: Uint8Array; compressed: boolean } {
  // "LZ77" マジック付きの亜種
  if (b.length > 8 && b[0] === 0x4c && b[1] === 0x5a && b[2] === 0x37 && b[3] === 0x37) {
    try {
      return { data: decompressLz(b.subarray(4)), compressed: true };
    } catch {
      /* 無視 */
    }
  }
  if (isLz(b)) {
    try {
      return { data: decompressLz(b), compressed: true };
    } catch {
      /* 圧縮ではなかった */
    }
  }
  return { data: b, compressed: false };
}
