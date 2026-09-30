import { expect, it } from 'vitest';
import SevenZip from '7z-wasm';
import { extractNds } from '../src/rom/extract-core';
import { buildNds } from './build';

it('7zアーカイブの中から.ndsを取り出せる', async () => {
  const sz = await SevenZip({ print: () => {}, printErr: () => {} });
  const nds = buildNds({ 'a.bin': Uint8Array.from([1, 2, 3]) });
  sz.FS.mkdir('/src');
  sz.FS.mkdir('/src/folder');
  sz.FS.writeFile('/src/folder/game.nds', nds);
  sz.FS.chdir('/src');
  sz.callMain(['a', '/test.7z', 'folder', '-bso0']);
  const out = extractNds(sz, '/test.7z');
  expect(out.name).toBe('game.nds');
  expect([...out.bytes]).toEqual([...nds]);
});
