/* 用 app.js 里真实的纯函数做 front-matter 往返测试：
   parse → build → parse，校验「值不丢、正文不变」。 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'public', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

/* front-matter 段的起点与终点：从 `const FIELDS = [` 到「front-matter ↔ 界面」注释 */
const START = 'const FIELDS = [';
const END = '  /* --------------------- front-matter ↔ 界面 --------------------- */';
const i0 = src.indexOf(START);
const i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0 || i1 <= i0) throw new Error('找不到 front-matter 代码段（FIELDS / 分隔注释）');
const section = src.slice(i0, i1);

const api = new Function(`${section}
  return { FIELDS, TYPE, parseFrontMatter, buildFrontMatter, collect: null };`)();

/* 文章目录：优先参数，其次环境变量 MDW_POSTS，最后从本文件向上找 source/_posts */
function findPosts() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  if (process.env.MDW_POSTS) return path.resolve(process.env.MDW_POSTS);
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, 'source', '_posts');
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const POSTS = findPosts();
if (!POSTS || !fs.existsSync(POSTS)) {
  console.log('跳过：没找到 source/_posts（指定方式：node test/fm-roundtrip.js <文章目录>）');
  process.exit(0);
}
console.log('文章目录：' + POSTS + '\n');

const files = fs.readdirSync(POSTS).filter((f) => /\.md$/i.test(f));

const keysOf = (text) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return [];
  return m[1]
    .split(/\r?\n/)
    .map((l) => {
      const kv = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(l);
      return kv ? { key: kv[1], hasValue: kv[2].trim().length > 0 } : null;
    })
    .filter(Boolean);
};

let bad = 0;
for (const f of files) {
  const original = fs.readFileSync(path.join(POSTS, f), 'utf8');
  const p1 = api.parseFrontMatter(original);

  const rebuiltFm = api.buildFrontMatter(p1.data, p1.extras, p1.order);
  const rebuilt = `${rebuiltFm}\n\n${p1.body}`;
  const p2 = api.parseFrontMatter(rebuilt);

  // 1) 正文逐字节一致（只忽略 front-matter 后面多出来的空行）
  const bodyOk = p2.body.replace(/^\n+/, '') === p1.body.replace(/^\n+/, '');

  // 2) 第一次解析出来的每个有值字段，第二次仍在且值相同
  const lost = [];
  for (const [k, v] of Object.entries(p1.data)) {
    if (!(k in p2.data)) { lost.push(k); continue; }
    if (JSON.stringify(v) !== JSON.stringify(p2.data[k])) lost.push(`${k}(${JSON.stringify(v)}→${JSON.stringify(p2.data[k])})`);
  }

  // 3) 未知字段（extras）原文仍在
  const extraLines = p1.extras.split('\n').filter((l) => l.trim());
  const extraLost = extraLines.filter((l) => !rebuilt.includes(l));

  // 4) 原始文件里的有值 key 一个都不能少
  const after = keysOf(rebuilt).map((k) => k.key);
  const missing = keysOf(original).filter((k) => k.hasValue && !after.includes(k.key)).map((k) => k.key);

  const same = rebuilt === original;
  const ok = bodyOk && lost.length === 0 && extraLost.length === 0 && missing.length === 0;
  if (!ok) bad++;

  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${f}  [${Object.keys(p1.data).length} 个字段]` +
      (same ? '  [逐字节一致]' : '') +
      (missing.length ? `  丢字段:${missing.join(',')}` : '') +
      (lost.length ? `  值变了:${lost.join(',')}` : '') +
      (extraLost.length ? `  丢附加行:${JSON.stringify(extraLost)}` : '') +
      (bodyOk ? '' : '  正文被改动!')
  );
  if (!ok || process.env.VERBOSE) {
    console.log('  --- 原始 ---\n' + original.split(/\r?\n/).slice(0, 14).join('\n'));
    console.log('  --- 重建 ---\n' + rebuilt.split(/\r?\n/).slice(0, 14).join('\n'));
  }
}

console.log(`\n共 ${files.length} 篇，异常 ${bad} 篇`);
process.exit(bad ? 1 : 0);
