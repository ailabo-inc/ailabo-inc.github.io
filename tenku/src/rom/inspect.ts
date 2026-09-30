// ファイルの種類判定（圧縮を展開してからNitro形式かを見る）
import { maybeDecompress } from './lz';
import { nitroKind } from './nitro';
import { magic } from './bytes';

export interface Inspected {
  data: Uint8Array; // 展開後
  compressed: boolean;
  kind: string; // NCLR / NCGR / NARC / ... / "?"
  head: string; // 先頭4バイト（表示用）
}

export function inspect(raw: Uint8Array): Inspected {
  const { data, compressed } = maybeDecompress(raw);
  const kind = nitroKind(data) ?? '?';
  return { data, compressed, kind, head: magic(data) };
}

/** ファイル一覧の構造レポート（中身は含めず、名前・サイズ・種類だけ） */
export function structureReport(
  meta: { title: string; gameCode: string },
  files: { path: string; size: number; kind: string; compressed: boolean; head: string }[],
): string {
  const lines = [`# ${meta.title} (${meta.gameCode}) files=${files.length}`];
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  lines.push('## kinds: ' + [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' '));
  lines.push('## path\tsize\tkind\tlz\thead');
  for (const f of files) lines.push(`${f.path}\t${f.size}\t${f.kind}\t${f.compressed ? 'lz' : ''}\t${f.head}`);
  return lines.join('\n');
}
