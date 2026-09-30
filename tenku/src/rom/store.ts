// 吸い出したROMは端末内（IndexedDB）だけに保存する。サーバーへは一切送らない
const DB = 'tenku';
const STORE = 'rom';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StoredRom {
  name: string;
  blob: Blob;
  savedAt: number;
}

export const saveRom = (rom: StoredRom) => tx('readwrite', (s) => s.put(rom, 'main'));
export const loadRom = () => tx<StoredRom | undefined>('readonly', (s) => s.get('main'));
export const deleteRom = () => tx('readwrite', (s) => s.delete('main'));

/** 選ばれたファイル（.nds / .7z / .zip）から .nds の中身を得る */
export async function romFromFile(file: File, onStatus: (s: string) => void): Promise<{ name: string; bytes: Uint8Array }> {
  if (/\.(nds|srl)$/i.test(file.name)) {
    onStatus('読み込み中…');
    return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  onStatus('アーカイブを展開中…（1分ほどかかることがあります）');
  try {
    return await extractInWorker(file);
  } catch (e) {
    // Workerが使えない環境（一部のサンドボックス等）ではメインスレッドで展開する
    console.warn('Worker展開に失敗、メインスレッドで再試行', e);
    const [{ default: SevenZip }, { default: wasmUrl }, { extractNds }] = await Promise.all([
      import('7z-wasm'),
      import('7z-wasm/7zz.wasm?url'),
      import('./extract-core'),
    ]);
    const sz = await SevenZip({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} });
    sz.FS.writeFile('/archive', new Uint8Array(await file.arrayBuffer()));
    return extractNds(sz, '/archive');
  }
}

async function extractInWorker(file: File): Promise<{ name: string; bytes: Uint8Array }> {
  const worker = new Worker(new URL('./extract.worker.ts', import.meta.url), { type: 'module' });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.ok) resolve({ name: e.data.name, bytes: new Uint8Array(e.data.buffer) });
        else reject(new Error(e.data.error));
      };
      worker.onerror = (e) => reject(new Error(e.message || '展開に失敗しました'));
      worker.postMessage({ file });
    });
  } finally {
    worker.terminate();
  }
}
