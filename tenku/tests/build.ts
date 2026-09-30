// テスト用：小さな疑似NDS / NARC / Nitroファイルを組み立てる
export class W {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 0xff); return this; }
  u16(v: number) { return this.u8(v).u8(v >> 8); }
  u32(v: number) { return this.u16(v).u16(v >>> 16); }
  str(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  bytes(a: ArrayLike<number>) { for (let i = 0; i < a.length; i++) this.u8(a[i]); return this; }
  pad(n: number) { while (this.b.length % n) this.u8(0); return this; }
  at(o: number) { while (this.b.length < o) this.u8(0); return this; }
  set32(o: number, v: number) { for (let i = 0; i < 4; i++) this.b[o + i] = (v >>> (i * 8)) & 0xff; }
  get pos() { return this.b.length; }
  out() { return Uint8Array.from(this.b); }
}

type Tree = { [name: string]: Uint8Array | Tree };

/** ディレクトリ木から FNT を作る。ファイルIDは深さ優先順 */
export function buildFnt(tree: Tree): { fnt: Uint8Array; files: Uint8Array[] } {
  const dirs: { tree: Tree; parent: number }[] = [];
  const files: Uint8Array[] = [];
  const collect = (t: Tree, parent: number) => {
    const id = dirs.length;
    dirs.push({ tree: t, parent });
    for (const v of Object.values(t)) if (!(v instanceof Uint8Array)) collect(v, 0xf000 + id);
    return id;
  };
  collect(tree, dirs.length);
  // ファイルIDを振る（ディレクトリ順）
  const firstId: number[] = [];
  for (const d of dirs) {
    firstId.push(files.length);
    for (const v of Object.values(d.tree)) if (v instanceof Uint8Array) files.push(v);
  }
  const subs: number[][] = [];
  // サブテーブル（ファイルを先、ディレクトリを後に並べる。IDの連番を保つため）
  dirs.forEach((d) => {
    const w = new W();
    for (const [n, v] of Object.entries(d.tree)) if (v instanceof Uint8Array) w.u8(n.length).str(n);
    for (const [n, v] of Object.entries(d.tree)) {
      if (!(v instanceof Uint8Array)) {
        const target = dirs.findIndex((x) => x.tree === v);
        w.u8(0x80 | n.length).str(n).u16(0xf000 + target);
      }
    }
    w.u8(0);
    subs.push(w.b);
  });
  const main = new W();
  let off = dirs.length * 8;
  dirs.forEach((d, i) => {
    main.u32(off).u16(firstId[i]).u16(i === 0 ? dirs.length : d.parent);
    off += subs[i].length;
  });
  for (const s of subs) main.bytes(s);
  return { fnt: main.out(), files };
}

export function buildNds(tree: Tree): Uint8Array {
  const { fnt, files } = buildFnt(tree);
  const w = new W();
  w.str('TENKU TEST').at(0x0c).str('TEST').str('01');
  w.at(0x200);
  const fntOff = w.pos;
  w.bytes(fnt).pad(4);
  const fatOff = w.pos;
  w.at(fatOff + files.length * 8);
  const pos: number[] = [];
  for (const f of files) {
    w.pad(4);
    pos.push(w.pos);
    w.bytes(f);
  }
  files.forEach((f, i) => {
    w.set32(fatOff + i * 8, pos[i]);
    w.set32(fatOff + i * 8 + 4, pos[i] + f.length);
  });
  w.set32(0x40, fntOff);
  w.set32(0x44, fnt.length);
  w.set32(0x48, fatOff);
  w.set32(0x4c, files.length * 8);
  w.set32(0x80, w.pos);
  return w.out();
}

function nitro(magic: string, sections: Uint8Array[]): Uint8Array {
  const w = new W();
  const total = 0x10 + sections.reduce((a, s) => a + s.length, 0);
  w.str(magic).u16(0xfeff).u16(0x0100).u32(total).u16(0x10).u16(sections.length);
  for (const s of sections) w.bytes(s);
  return w.out();
}

function section(magic: string, body: W): Uint8Array {
  const w = new W();
  w.str(magic).u32(body.b.length + 8).bytes(body.b);
  return w.out();
}

export function buildNarc(files: Uint8Array[]): Uint8Array {
  const fat = new W().u16(files.length).u16(0);
  let o = 0;
  const img = new W();
  for (const f of files) {
    fat.u32(o).u32(o + f.length);
    img.bytes(f).pad(4);
    o = img.pos;
  }
  const fnt = new W().u32(4).u16(0).u16(1);
  return nitro('NARC', [section('BTAF', fat), section('BTNF', fnt), section('GMIF', img)]);
}

export function buildNclr(colors555: number[]): Uint8Array {
  const body = new W().u16(3).u16(0).u32(0).u32(colors555.length * 2).u32(0x10);
  for (const c of colors555) body.u16(c);
  return nitro('RLCN', [section('TTLP', body)]);
}

export function buildNcgr(tilesX: number, tilesY: number, data4bpp: Uint8Array): Uint8Array {
  const body = new W().u16(tilesY).u16(tilesX).u32(3).u16(0).u16(0).u32(0).u32(data4bpp.length).u32(0x18).bytes(data4bpp);
  return nitro('RGCN', [section('RAHC', body)]);
}

/** 圧縮なし（全リテラル）の LZ10 ストリーム */
export function lz10Literal(data: Uint8Array): Uint8Array {
  const w = new W().u8(0x10).u8(data.length).u8(data.length >> 8).u8(data.length >> 16);
  for (let i = 0; i < data.length; i += 8) {
    w.u8(0);
    w.bytes(data.subarray(i, i + 8));
  }
  return w.out();
}
