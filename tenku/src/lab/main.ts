// 天空ラボ：端末内のROMを読み込み、中身（ファイル・画像・パレット）を調べるツール
import './style.css';
import { parseNds, type NdsRom } from '../rom/nds';
import { inspect, structureReport, type Inspected } from '../rom/inspect';
import {
  grayscalePalette,
  parseNarc,
  parseNclr,
  parseNcgr,
  parseNscr,
  readPaletteRaw,
  renderScreen,
  renderTiles,
  type Image,
  type Rgba,
} from '../rom/nitro';
import { deleteRom, loadRom, romFromFile, saveRom } from '../rom/store';

interface Entry {
  name: string;
  size: number;
  get(): Uint8Array;
}
interface Level {
  label: string;
  entries: Entry[];
}

const app = document.getElementById('app')!;
let rom: NdsRom | null = null;
let stack: Level[] = [];
let selected: Entry | null = null;
let filter = '';
let palette: { name: string; colors: Rgba[] } | null = null;
const raw = { bpp: 4 as 4 | 8, width: 16, offset: 0, tiled: true, bank: 0 };
const cache = new WeakMap<Entry, Inspected>();

const h = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const kb = (n: number) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)}MB` : n >= 1024 ? `${(n / 1024).toFixed(1)}KB` : `${n}B`);

function look(e: Entry): Inspected {
  let v = cache.get(e);
  if (!v) {
    v = inspect(e.get());
    cache.set(e, v);
  }
  return v;
}

// ---------- 起動 ----------

async function boot() {
  renderShell('端末内の保存データを確認中…');
  try {
    const stored = await loadRom();
    if (stored) {
      openRom(stored.name, new Uint8Array(await stored.blob.arrayBuffer()));
      return;
    }
  } catch (e) {
    console.warn(e);
  }
  renderShell();
}

function openRom(name: string, bytes: Uint8Array) {
  rom = parseNds(bytes);
  stack = [
    {
      label: rom.header.title || name,
      entries: rom.files.map((f) => ({ name: f.path, size: f.size, get: () => rom!.read(f) })),
    },
  ];
  selected = null;
  render();
}

async function onPick(file: File) {
  try {
    const { name, bytes } = await romFromFile(file, (s) => renderShell(s));
    renderShell('端末内に保存中…');
    openRom(name, bytes);
    await saveRom({ name, blob: new Blob([bytes as BlobPart]), savedAt: Date.now() });
    render();
  } catch (e) {
    renderShell(`<span class="bad">読み込めませんでした：${h(String((e as Error).message ?? e))}</span>`);
  }
}

// ---------- 画面 ----------

function renderShell(status = '') {
  app.innerHTML = `
    <h1>天空ラボ<small>ROM解析ツール</small></h1>
    <div class="panel">
      <p>自分で吸い出したDSのROM（<b>.nds</b> か、それを圧縮した <b>.7z / .zip</b>）を選んでください。
      ROMはこの端末の中だけで読み込まれ、どこにも送信されません。</p>
      <div class="row">
        <label class="btn">ROMを選ぶ<input type="file" id="pick" hidden></label>
      </div>
      <p class="dim" id="status">${status}</p>
    </div>`;
  app.querySelector<HTMLInputElement>('#pick')!.onchange = (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) onPick(f);
  };
}

function render() {
  if (!rom) return renderShell();
  const level = stack[stack.length - 1];
  const q = filter.toLowerCase();
  const shown = level.entries.filter((e) => !q || e.name.toLowerCase().includes(q)).slice(0, 2000);

  app.innerHTML = `
    <h1>天空ラボ<small>${h(rom.header.title)} / ${h(rom.header.gameCode)} / ${rom.files.length}ファイル</small></h1>
    <div class="panel">
      <div class="crumb">${stack
        .map((l, i) => (i < stack.length - 1 ? `<a data-up="${i}">${h(l.label)}</a>` : h(l.label)))
        .join(' / ')}</div>
      <div class="row" style="margin-top:8px">
        <input type="search" id="q" placeholder="ファイル名で絞り込み" value="${h(filter)}">
        <button id="report">構造レポート</button>
      </div>
      <div class="list" id="list">${shown
        .map(
          (e, i) => `<div class="item${e === selected ? ' sel' : ''}" data-i="${i}">
            <span class="name">${h(e.name)}</span><span class="tag">${kb(e.size)}</span></div>`,
        )
        .join('')}</div>
      <p class="dim">${shown.length}/${level.entries.length}件表示${palette ? ` ・ 使用中パレット: ${h(palette.name)}` : ''}</p>
    </div>
    <div id="detail"></div>
    <div class="panel row">
      <span class="dim">ROMは端末内に保存されています</span>
      <button id="forget">端末から削除</button>
    </div>`;

  const qEl = app.querySelector<HTMLInputElement>('#q')!;
  qEl.oninput = () => {
    filter = qEl.value;
    const pos = qEl.selectionStart;
    render();
    const again = app.querySelector<HTMLInputElement>('#q')!;
    again.focus();
    again.setSelectionRange(pos, pos);
  };
  app.querySelectorAll<HTMLElement>('[data-up]').forEach((a) => {
    a.onclick = () => {
      stack = stack.slice(0, Number(a.dataset.up) + 1);
      selected = null;
      filter = '';
      render();
    };
  });
  app.querySelectorAll<HTMLElement>('.item').forEach((el) => {
    el.onclick = () => {
      selected = shown[Number(el.dataset.i)];
      raw.offset = 0;
      render();
      document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth' });
    };
  });
  app.querySelector<HTMLButtonElement>('#report')!.onclick = () => copyReport();
  app.querySelector<HTMLButtonElement>('#forget')!.onclick = async () => {
    if (!confirm('端末に保存したROMを削除しますか？')) return;
    await deleteRom();
    rom = null;
    stack = [];
    renderShell('削除しました');
  };
  if (selected) renderDetail(selected);
}

function renderDetail(e: Entry) {
  const box = document.getElementById('detail')!;
  let info: Inspected;
  try {
    info = look(e);
  } catch (err) {
    box.innerHTML = `<div class="panel bad">${h(String(err))}</div>`;
    return;
  }
  const { data, kind, compressed } = info;
  box.innerHTML = `<div class="panel">
    <div class="row"><b class="name">${h(e.name)}</b>
      <span class="tag k">${h(kind)}</span>${compressed ? `<span class="tag">LZ圧縮→${kb(data.length)}</span>` : ''}</div>
    <div id="view"></div>
    <details><summary class="dim">先頭のバイト列</summary><pre class="hex">${hexdump(data, 0, 512)}</pre></details>
  </div>`;
  const view = box.querySelector<HTMLElement>('#view')!;

  try {
    if (kind === 'NARC') return viewNarc(view, e, data);
    if (kind === 'NCLR') return viewPalette(view, e.name, parseNclr(data).colors);
    if (kind === 'NCGR') {
      const t = parseNcgr(data);
      const pal = palette?.colors ?? grayscalePalette(t.bpp);
      const w = t.tilesX || raw.width;
      view.append(note(`${t.bpp}bpp / ${t.tilesX}x${t.tilesY}タイル${palette ? '' : '（パレット未選択のため白黒表示）'}`));
      view.append(canvasOf(renderTiles(t.data, t.bpp, pal, w, { tiled: t.tiled, paletteBank: raw.bank })));
      return;
    }
    if (kind === 'NSCR') return viewScreen(view, e, data);
  } catch (err) {
    view.append(note(`この形式の表示に失敗：${String((err as Error).message ?? err)}（生データ表示に切替）`));
  }
  viewRaw(view, data);
}

function viewNarc(view: HTMLElement, e: Entry, data: Uint8Array) {
  const entries = parseNarc(data);
  view.append(note(`アーカイブ：${entries.length}ファイル`));
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.textContent = '中を開く';
  btn.onclick = () => {
    stack.push({
      label: e.name.split('/').pop()!,
      entries: entries.map((x) => ({ name: x.name, size: x.data.length, get: () => x.data })),
    });
    selected = null;
    filter = '';
    render();
    window.scrollTo({ top: 0 });
  };
  view.append(btn);
}

function viewPalette(view: HTMLElement, name: string, colors: Rgba[]) {
  const grid = document.createElement('div');
  grid.className = 'pal';
  for (const c of colors.slice(0, 256)) {
    const d = document.createElement('div');
    d.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
    grid.append(d);
  }
  view.append(note(`${colors.length}色`), grid);
  const btn = document.createElement('button');
  btn.className = 'primary';
  btn.style.marginTop = '8px';
  btn.textContent = 'このパレットで画像を見る';
  btn.onclick = () => {
    palette = { name: name.split('/').pop()!, colors };
    render();
  };
  view.append(btn);
}

function viewScreen(view: HTMLElement, e: Entry, data: Uint8Array) {
  const scr = parseNscr(data);
  // 同じ階層にある NCGR / NCLR を名前の近さで探す
  const level = stack[stack.length - 1];
  const stem = e.name.replace(/\.[^.]+$/, '');
  const near = (k: string) =>
    level.entries.find((x) => x.name.startsWith(stem) && x !== e && safeKind(x) === k) ??
    level.entries.find((x) => safeKind(x) === k);
  const g = near('NCGR');
  const p = near('NCLR');
  if (!g) {
    view.append(note(`${scr.width}x${scr.height}px のマップ（対応する NCGR が同じ階層に見つかりません）`));
    return;
  }
  const tiles = parseNcgr(look(g).data);
  const colors = palette?.colors ?? (p ? parseNclr(look(p).data).colors : grayscalePalette(tiles.bpp));
  view.append(note(`${scr.width}x${scr.height}px / 画像: ${g.name}${p ? ` / パレット: ${p.name}` : ''}`));
  view.append(canvasOf(renderScreen(scr, tiles, colors)));
}

function safeKind(e: Entry): string {
  try {
    return look(e).kind;
  } catch {
    return '?';
  }
}

/** 形式不明のデータをタイル画像として眺める（DQ5独自形式の解析用） */
function viewRaw(view: HTMLElement, data: Uint8Array) {
  const ctl = document.createElement('div');
  ctl.className = 'row';
  ctl.innerHTML = `
    <select id="bpp"><option value="4">4bpp</option><option value="8">8bpp</option></select>
    <label class="dim">幅 <input type="number" id="w" min="1" max="64" value="${raw.width}"></label>
    <label class="dim">開始 <input type="number" id="off" min="0" step="32" value="${raw.offset}"></label>
    <select id="mode"><option value="1">8x8タイル</option><option value="0">ベタ並び</option></select>
    <button id="asPal">パレットとして見る</button>`;
  view.append(note('形式不明のデータ。数値を変えて絵が浮かび上がるか確認できます'), ctl);
  (ctl.querySelector('#bpp') as HTMLSelectElement).value = String(raw.bpp);
  (ctl.querySelector('#mode') as HTMLSelectElement).value = raw.tiled ? '1' : '0';
  const wrap = document.createElement('div');
  view.append(wrap);
  const draw = () => {
    raw.bpp = Number((ctl.querySelector('#bpp') as HTMLSelectElement).value) as 4 | 8;
    raw.width = Math.max(1, Number((ctl.querySelector('#w') as HTMLInputElement).value) || 16);
    raw.offset = Math.max(0, Number((ctl.querySelector('#off') as HTMLInputElement).value) || 0);
    raw.tiled = (ctl.querySelector('#mode') as HTMLSelectElement).value === '1';
    const slice = data.subarray(raw.offset, raw.offset + 64 * 1024);
    const pal = palette?.colors ?? grayscalePalette(raw.bpp);
    wrap.replaceChildren(canvasOf(renderTiles(slice, raw.bpp, pal, raw.width, { tiled: raw.tiled, paletteBank: raw.bank })));
  };
  ctl.querySelectorAll('select,input').forEach((el) => el.addEventListener('change', draw));
  (ctl.querySelector('#asPal') as HTMLButtonElement).onclick = () => {
    wrap.replaceChildren();
    viewPalette(wrap, `raw@${raw.offset}`, readPaletteRaw(data, raw.offset, 256));
  };
  draw();
}

// ---------- 部品 ----------

function note(text: string) {
  const p = document.createElement('p');
  p.className = 'dim';
  p.textContent = text;
  return p;
}

function canvasOf(img: Image) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(new ImageData(img.rgba as never, img.width, img.height), 0, 0);
  // 小さい絵は拡大して見やすく
  const scale = Math.max(1, Math.min(4, Math.floor(320 / img.width)));
  c.style.width = `${img.width * scale}px`;
  return c;
}

function hexdump(b: Uint8Array, start: number, len: number) {
  const lines: string[] = [];
  for (let o = start; o < Math.min(b.length, start + len); o += 16) {
    const row = b.subarray(o, o + 16);
    const hex = [...row].map((x) => x.toString(16).padStart(2, '0')).join(' ');
    const asc = [...row].map((x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('');
    lines.push(`${o.toString(16).padStart(6, '0')}  ${hex.padEnd(48)}  ${h(asc)}`);
  }
  return lines.join('\n');
}

async function copyReport() {
  if (!rom) return;
  const files = rom.files.map((f) => {
    const raw = rom!.read(f);
    // 巨大ファイルは展開せず先頭だけで判定
    const i = f.size < 4 << 20 ? safeInspect(raw) : { kind: '?', compressed: false, head: '' };
    return { path: f.path, size: f.size, kind: i.kind, compressed: i.compressed, head: i.head };
  });
  const text = structureReport(rom.header, files);
  try {
    await navigator.clipboard.writeText(text);
    alert(`構造レポートをコピーしました（${files.length}件）。ファイル名・サイズ・種類だけで、ROMの中身は含まれません。`);
  } catch {
    const w = window.open();
    w?.document.write(`<pre>${h(text)}</pre>`);
  }
}

function safeInspect(b: Uint8Array) {
  try {
    return inspect(b);
  } catch {
    return { kind: '?', compressed: false, head: '' };
  }
}

boot();
