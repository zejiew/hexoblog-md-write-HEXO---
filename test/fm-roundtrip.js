/* 用真实 app.js 里的 parseFrontMatter / buildFrontMatter 做 front-matter 往返测试 */
'use strict';
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'public', 'app.js');
const src = fs.readFileSync(APP, 'utf8');

function grab(name) {
  const re = new RegExp(`\\n  function ${name}\\([\\s\\S]*?\\n  \\}\\n`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error('找不到函数 ' + name);
  return m[0];
}

const knownLine = /const KNOWN = \[[^\]]*\];/.exec(src);
if (!knownLine) throw new Error('找不到 KNOWN');

const code = `
${knownLine[0]}
${grab('parseFrontMatter')}
${grab('buildFrontMatter')}
return { parseFrontMatter, buildFrontMatter };
`;

const el = {
  title: { value: '' },
  date: { value: '' },
  tags: { value: '' },
  categories: { value: '' },
};
const state = { extras: '', dateRaw: '' };
const pad2 = (n) => String(n).padStart(2, '0');
const todayValue = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

const api = new Function('el', 'state', 'pad2', 'todayValue', code)(el, state, pad2, todayValue);

/* 文章目录：优先 --dir 参数，其次环境变量 MDW_POSTS，最后从本文件向上找 source/_posts */
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

let bad = 0;
for (const f of files) {
  const original = fs.readFileSync(path.join(POSTS, f), 'utf8');
  const { data, extras, body } = api.parseFrontMatter(original);

  el.title.value = data.title || f.replace(/\.md$/i, '');
  el.tags.value = Array.isArray(data.tags) ? data.tags.join(', ') : data.tags || '';
  el.categories.value = Array.isArray(data.categories) ? data.categories.join(', ') : data.categories || '';
  const d = String(data.date || '');
  const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(d);
  el.date.value = m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : todayValue();
  state.extras = extras;
  state.dateRaw = d;

  const rebuiltRaw = api.buildFrontMatter();
  const rebuilt = rebuiltRaw + '\n' + body.replace(/\s+$/, '') + '\n';

  // 1) 正文必须逐字节一致
  const bodyOk = rebuilt.includes(body.replace(/\s+$/, ''));

  // 2) 原始 front-matter 里的每个 key 都必须还在
  const keysOf = (t) => {
    const mm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
    if (!mm) return [];
    return mm[1]
      .split(/\r?\n/)
      .map((l) => {
        const kv = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(l);
        return kv ? { key: kv[1], hasValue: kv[2].trim().length > 0 } : null;
      })
      .filter(Boolean);
  };
  const before = keysOf(original);
  const after = keysOf(rebuilt).map((k) => k.key);
  // 空值 key（如 `tags:` 后面啥也没有）被丢掉不改变 Hexo 行为，不算失败
  const lost = before.filter((k) => k.hasValue && !after.includes(k.key)).map((k) => k.key);
  const droppedEmpty = before.filter((k) => !k.hasValue && !after.includes(k.key)).map((k) => k.key);

  // 3) 未知字段原文必须出现在新 front-matter 里
  const extraLines = extras.split('\n').filter((l) => l.trim());
  const extraLost = extraLines.filter((l) => !rebuilt.includes(l));

  const same = rebuilt === original;
  const ok = bodyOk && lost.length === 0 && extraLost.length === 0;
  if (!ok) bad++;

  console.log(
    `${ok ? 'OK  ' : 'FAIL'} ${f}` +
      (same ? '  [完全一致]' : '') +
      (lost.length ? `  丢字段:${lost.join(',')}` : '') +
      (droppedEmpty.length ? `  空字段省略:${droppedEmpty.join(',')}` : '') +
      (extraLost.length ? `  丢附加行:${JSON.stringify(extraLost)}` : '') +
      (bodyOk ? '' : '  正文被改动!')
  );
  if (!ok || process.env.VERBOSE) {
    console.log('  --- 原始 ---');
    console.log(original.split(/\r?\n/).slice(0, 12).join('\n'));
    console.log('  --- 重建 ---');
    console.log(rebuilt.split(/\r?\n/).slice(0, 12).join('\n'));
  }
}
console.log(`\n共 ${files.length} 篇，异常 ${bad} 篇`);
process.exit(bad ? 1 : 0);
