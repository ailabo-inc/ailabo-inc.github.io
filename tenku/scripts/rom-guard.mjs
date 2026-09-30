// ROM・ROM由来の素材が git に入っていないかを検査する（このリポジトリは公開サイトのため）
import { execSync } from 'node:child_process';
import { openSync, readSync, closeSync, statSync } from 'node:fs';

const root = execSync('git rev-parse --show-toplevel').toString().trim();
const files = execSync('git ls-files -z --cached --others --exclude-standard', { cwd: root })
  .toString()
  .split('\0')
  .filter(Boolean);

const badExt = /\.(nds|srl|7z|sfc|smc|gba|gb|gbc|n64|z64|iso|cia|3ds|sav|narc|nclr|ncgr|nscr|ncer|nanr|nsbmd|nsbtx|sdat|sseq|swar|sbnk|strm)$/i;
const badDir = /(^|\/)(roms|extracted|dump)\/|^tenku\/rom\//i;
const problems = [];
for (const f of files) {
  if (badExt.test(f) || badDir.test(f)) {
    problems.push(`${f}（ROM・抽出データの可能性）`);
    continue;
  }
  const p = `${root}/${f}`;
  let size = 0;
  try {
    size = statSync(p).size;
  } catch {
    continue;
  }
  if (size < 0x200) continue;
  // 拡張子を変えたNDS ROMも検出する（ヘッダーのロゴCRC 0xCF56 @0x15C）
  const fd = openSync(p, 'r');
  const buf = Buffer.alloc(2);
  readSync(fd, buf, 0, 2, 0x15c);
  closeSync(fd);
  if (buf.readUInt16LE(0) === 0xcf56 && size > 1 << 20) problems.push(`${f}（NDS ROMヘッダーを検出）`);
}
if (problems.length) {
  console.error('公開リポジトリに入れてはいけないファイルがあります:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`rom-guard: OK（${files.length}ファイル検査）`);
