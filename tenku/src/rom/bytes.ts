// バイト列の読み取りヘルパー（DSはリトルエンディアン）

export class Reader {
  readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  get length(): number {
    return this.bytes.length;
  }
  u8(o: number): number {
    return this.bytes[o];
  }
  u16(o: number): number {
    return this.view.getUint16(o, true);
  }
  u32(o: number): number {
    return this.view.getUint32(o, true);
  }
  ascii(o: number, len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) {
      const c = this.bytes[o + i];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
  sub(o: number, len: number): Uint8Array {
    return this.bytes.subarray(o, o + len);
  }
}

export function magic(bytes: Uint8Array, o = 0): string {
  let s = '';
  for (let i = 0; i < 4 && o + i < bytes.length; i++) {
    const c = bytes[o + i];
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '.';
  }
  return s;
}
