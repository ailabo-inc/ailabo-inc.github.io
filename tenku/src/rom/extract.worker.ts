// アーカイブ展開用Worker。元ファイルはWORKERFSでコピーせず参照し、メモリ使用量を抑える
import SevenZip from '7z-wasm';
import wasmUrl from '7z-wasm/7zz.wasm?url';
import { extractNds } from './extract-core';

self.onmessage = async (e: MessageEvent<{ file: File }>) => {
  try {
    const { file } = e.data;
    const sz = await SevenZip({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} });
    sz.FS.mkdir('/in');
    sz.FS.mount(sz.WORKERFS, { files: [file] } as never, '/in');
    const { name, bytes } = extractNds(sz, `/in/${file.name}`);
    const copy = bytes.slice().buffer;
    (self as unknown as Worker).postMessage({ ok: true, name, buffer: copy }, [copy]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
