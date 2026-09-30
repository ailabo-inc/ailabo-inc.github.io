import { describe, expect, it } from 'vitest';
import { parseNds } from '../src/rom/nds';
import { decompressLz, maybeDecompress } from '../src/rom/lz';
import { parseNarc, parseNclr, parseNcgr, renderTiles, nitroKind } from '../src/rom/nitro';
import { inspect, structureReport } from '../src/rom/inspect';
import { buildNarc, buildNclr, buildNcgr, buildNds, lz10Literal } from './build';

const bytes = (...v: number[]) => Uint8Array.from(v);

describe('NDS', () => {
  it('ヘッダーとディレクトリ付きファイル一覧を読める', () => {
    const rom = parseNds(
      buildNds({
        'a.bin': bytes(1, 2, 3),
        data: { 'x.bin': bytes(9), sub: { 'deep.bin': bytes(7, 7) } },
        'z.bin': bytes(5),
      }),
    );
    expect(rom.header.title).toBe('TENKU TEST');
    expect(rom.header.gameCode).toBe('TEST');
    const byPath = Object.fromEntries(rom.files.map((f) => [f.path, [...rom.read(f)]]));
    expect(byPath).toEqual({ 'a.bin': [1, 2, 3], 'z.bin': [5], 'data/x.bin': [9], 'data/sub/deep.bin': [7, 7] });
  });

  it('NDSでないデータはエラーにする', () => {
    expect(() => parseNds(new Uint8Array(100))).toThrow();
  });
});

describe('LZ', () => {
  it('LZ10: リテラルと後方参照', () => {
    // "ABC" + 参照(距離3, 長さ6) => "ABCABCABC"
    const src = bytes(0x10, 9, 0, 0, 0b00010000, 0x41, 0x42, 0x43, 0x30, 0x02);
    expect(new TextDecoder().decode(decompressLz(src))).toBe('ABCABCABC');
  });

  it('LZ11: 短い参照', () => {
    // "AB" + 参照(ind=3 → 長さ4, 距離2) => "ABABAB"
    const src = bytes(0x11, 6, 0, 0, 0b00100000, 0x41, 0x42, 0x30, 0x01);
    expect(new TextDecoder().decode(decompressLz(src))).toBe('ABABAB');
  });

  it('圧縮されていないデータはそのまま', () => {
    const d = bytes(0x42, 0x42, 0x42, 0x42, 0x42);
    expect(maybeDecompress(d)).toEqual({ data: d, compressed: false });
  });
});

describe('Nitro形式', () => {
  it('NARCの中身を取り出せる', () => {
    const narc = buildNarc([bytes(1, 2), bytes(3, 4, 5)]);
    expect(nitroKind(narc)).toBe('NARC');
    expect(parseNarc(narc).map((e) => [...e.data])).toEqual([[1, 2], [3, 4, 5]]);
    expect(parseNarc(narc).map((e) => e.name)).toEqual(['0000.bin', '0001.bin']);
  });

  it('NCLRのBGR555色を変換する', () => {
    const pal = parseNclr(buildNclr([0x0000, 0x001f, 0x03e0, 0x7c00, 0x7fff]));
    expect(pal.bpp).toBe(4);
    expect(pal.colors.slice(0, 5)).toEqual([
      [0, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('NCGRの4bppタイルをパレットで描画する', () => {
    const tile = new Uint8Array(32).fill(0x21); // 左=色1, 右=色2 の繰り返し
    const t = parseNcgr(buildNcgr(1, 1, tile));
    expect([t.bpp, t.tilesX, t.tilesY, t.tiled]).toEqual([4, 1, 1, true]);
    const pal = parseNclr(buildNclr([0, 0x001f, 0x7c00])).colors;
    const img = renderTiles(t.data, t.bpp, pal, 1);
    expect([img.width, img.height]).toEqual([8, 8]);
    expect([...img.rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it('LZ圧縮されたNARCも種類を判定できる', () => {
    const i = inspect(lz10Literal(buildNarc([bytes(1)])));
    expect([i.kind, i.compressed]).toEqual(['NARC', true]);
  });
});

it('構造レポートには中身を含めない', () => {
  const r = structureReport({ title: 'T', gameCode: 'G' }, [
    { path: 'a.narc', size: 10, kind: 'NARC', compressed: true, head: 'NARC' },
  ]);
  expect(r).toContain('a.narc\t10\tNARC\tlz');
  expect(r.split('\n')).toHaveLength(4);
});
