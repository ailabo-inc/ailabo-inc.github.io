// 7z / zip から .nds を取り出す処理（Worker と Node テストで共用）
import type { SevenZipModule } from '7z-wasm';

export function findNds(sz: SevenZipModule, dir: string): string | null {
  for (const name of sz.FS.readdir(dir)) {
    if (name === '.' || name === '..') continue;
    const p = `${dir}/${name}`;
    const st = sz.FS.stat(p);
    if (sz.FS.isDir(st.mode)) {
      const hit = findNds(sz, p);
      if (hit) return hit;
    } else if (/\.(nds|srl)$/i.test(name)) {
      return p;
    }
  }
  return null;
}

/** archivePath のアーカイブを /out に展開し、中の .nds を返す */
export function extractNds(sz: SevenZipModule, archivePath: string): { name: string; bytes: Uint8Array } {
  try {
    sz.FS.mkdir('/out');
  } catch {
    /* 既にある */
  }
  sz.callMain(['x', archivePath, '-o/out', '-y', '-bso0', '-bsp0']);
  const hit = findNds(sz, '/out');
  if (!hit) throw new Error('アーカイブの中に .nds ファイルが見つかりませんでした');
  const bytes = sz.FS.readFile(hit) as Uint8Array;
  return { name: hit.split('/').pop() ?? 'rom.nds', bytes };
}
