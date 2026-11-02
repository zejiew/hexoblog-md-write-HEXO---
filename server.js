#!/usr/bin/env node
/**
 * 写作台 · 本地 Markdown 写稿服务
 * ---------------------------------------------------------------
 * 零依赖（Node 18+ 内置 fetch/FormData）。
 * 职责：
 *   1. 托管编辑器界面（public/）
 *   2. 代理图片上传到 CloudFlare-ImgBed（绕开浏览器跨域限制）
 *   3. 直接读写博客的 source/_posts 目录
 *   4. 一键执行 hexo clean && hexo generate [-d]
 *
 * 用法：
 *   node server.js                      # 自动向上寻找博客根目录
 *   node server.js --blog D:\my-blog    # 手动指定博客根目录
 *   node server.js --port 8899 --open   # 指定端口并自动打开浏览器
 *
 * 环境变量：MDW_BLOG（同 --blog）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const { spawn } = require('child_process');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

/* 命令行参数：--blog <dir> / --port <n> / --open */
const ARGS = (() => {
  const argv = process.argv.slice(2);
  const out = { blog: '', port: 0, open: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--blog' && argv[i + 1]) out.blog = argv[++i];
    else if (a.startsWith('--blog=')) out.blog = a.slice(7);
    else if (a === '--port' && argv[i + 1]) out.port = Number(argv[++i]) || 0;
    else if (a.startsWith('--port=')) out.port = Number(a.slice(7)) || 0;
    else if (a === '--open' || a === '-o') out.open = true;
  }
  return out;
})();

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadConfig() {
  const base = readJson(path.join(ROOT, 'config.json'), {});
  const local = readJson(path.join(ROOT, 'config.local.json'), {});
  const cfg = {
    port: 8787,
    host: '127.0.0.1',
    /* 留空即可，使用者可在界面「设置」里填写，或在 config.local.json 里填 */
    imgbedBase: '',
    authCode: '',
    uploadChannel: '',
    returnFormat: 'full',
    postsDir: 'source/_posts',
    blogRoot: '',
    imageInsertFormat: 'markdown',
    ...base,
    ...local,
  };
  cfg.imgbedBase = String(cfg.imgbedBase || '').trim().replace(/\/+$/, '');
  return cfg;
}

let CONFIG = loadConfig();

/* ------------------------------------------------------------------ */
/* 定位博客根目录                                                       */
/* ------------------------------------------------------------------ */

function looksLikeBlog(dir, strict) {
  try {
    const hasPosts = fs.existsSync(path.join(dir, 'source', '_posts')) ||
      (CONFIG.postsDir && fs.existsSync(path.resolve(dir, CONFIG.postsDir)));
    if (!hasPosts) return false;
    if (!strict) return true;
    return fs.existsSync(path.join(dir, '_config.yml')) || fs.existsSync(path.join(dir, '_config.yaml'));
  } catch {
    return false;
  }
}

function findBlogRoot(explicit) {
  const candidates = [];
  if (explicit) candidates.push(path.resolve(explicit));
  if (CONFIG.blogRoot) candidates.push(path.resolve(ROOT, CONFIG.blogRoot));
  candidates.push(process.cwd());
  /* 从本文件所在目录一路向上找：工具通常放在 blog/tools/xxx 里 */
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  /* 先找严格的（有 _config.yml），再放宽 */
  for (const strict of [true, false]) {
    for (const c of candidates) {
      if (fs.existsSync(c) && looksLikeBlog(c, strict)) return c;
    }
  }
  return null;
}

let BLOG_ROOT = findBlogRoot(process.env.MDW_BLOG || ARGS.blog);
let POSTS_DIR = BLOG_ROOT ? path.resolve(BLOG_ROOT, CONFIG.postsDir) : null;

function requireBlog() {
  return BLOG_ROOT !== null;
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const len = isBuf ? body.length : Buffer.byteLength(body || '');
  res.writeHead(status, {
    'Content-Length': len,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 只允许 _posts 目录下的 .md 文件，防目录穿越 */
function safePostPath(name) {
  if (!POSTS_DIR) return null;
  if (typeof name !== 'string' || !name) return null;
  const clean = path.basename(String(name).replace(/\\/g, '/')).trim();
  if (!clean || clean === '.' || clean === '..') return null;
  if (!/\.md$/i.test(clean)) return null;
  const full = path.resolve(POSTS_DIR, clean);
  if (!full.startsWith(POSTS_DIR + path.sep)) return null;
  return full;
}

function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { title: '', date: '', tags: [], categories: [], body: text };
  const meta = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) return;
    let value = kv[2].trim();
    if (/^\[.*\]$/.test(value)) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    } else {
      value = value.replace(/^['"]|['"]$/g, '');
    }
    meta[kv[1]] = value;
  });
  const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
  return {
    title: meta.title || '',
    date: meta.date || '',
    tags: toArr(meta.tags),
    categories: toArr(meta.categories),
    body: text.slice(m[0].length),
  };
}

function yamlList(arr) {
  return '[' + arr.map((s) => JSON.stringify(String(s))).join(', ') + ']';
}

/** 根据标题生成安全文件名 */
function fileNameFromTitle(title) {
  const t = String(title || '')
    // Windows/Linux 非法字符 + 控制字符
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80);
  return (t || 'untitled') + '.md';
}

/* ------------------------------------------------------------------ */
/* 图床上传                                                            */
/* ------------------------------------------------------------------ */

async function uploadToImgbed({ buffer, filename, mime, authCode, folder, base }) {
  const params = new URLSearchParams();
  if (authCode) params.set('authCode', authCode);
  if (CONFIG.uploadChannel) params.set('uploadChannel', CONFIG.uploadChannel);
  params.set('returnFormat', CONFIG.returnFormat || 'full');
  params.set('responseFormat', 'object');
  if (folder) params.set('uploadFolder', folder);

  const url = `${base}/upload?${params.toString()}`;
  const fd = new FormData();
  const blob = new Blob([buffer], { type: mime || 'application/octet-stream' });
  fd.append('file', blob, filename || 'image.png');

  const started = Date.now();
  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(90000),
    });
  } catch (err) {
    throw Object.assign(
      new Error(`无法连接图床：${err.name === 'TimeoutError' ? '请求超时' : err.message}`),
      { status: 502 }
    );
  }

  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  if (!resp.ok) {
    let hint;
    if (resp.status === 401) hint = '认证码不正确或未配置（请到图床后台确认）';
    else if (resp.status === 404 || resp.status === 405)
      hint = '上传接口不存在，检查图床地址是否填对（应填到域名，不要带 /upload）';
    else hint = (data && (data.message || data.error)) || text.slice(0, 200);
    throw Object.assign(new Error(`图床返回 ${resp.status}：${hint}`), { status: 502 });
  }

  const item = Array.isArray(data) ? data[0] : data;
  if (!item || !item.src) {
    throw Object.assign(new Error('图床未返回链接：' + text.slice(0, 200)), { status: 502 });
  }
  let src = item.src;
  if (src.startsWith('/')) src = base + src;
  return { url: item.publicUrl || src, raw: src, elapsed: Date.now() - started };
}

/* ------------------------------------------------------------------ */
/* Hexo 构建                                                           */
/* ------------------------------------------------------------------ */

/**
 * 为什么不直接用 child_process 的管道收集输出：
 * 某些受限环境（沙箱/策略）里创建匿名管道会被拒绝，spawn 直接抛 `spawn EPERM`。
 * 做法：让子进程把 stdout/stderr 直接写到「日志文件描述符」上（不经管道），
 * 服务端再从该文件增量读取 —— 任何环境都能跑，也顺便有了持久日志。
 */

const BUILD_LOG = path.join(os.tmpdir(), `mdw-hexo-build-${process.pid}.log`);

const build = {
  running: false,
  exit: null,
  startedAt: 0,
  seq: 0,
  lines: [],
  offset: 0,      // 已读到的文件字节位置
  pending: '',    // 尚未写完的半行
  decoder: new StringDecoder('utf8'),
};

function pushLine(line) {
  build.lines.push(line);
  build.seq++;
  if (build.lines.length > 4000) build.lines.splice(0, build.lines.length - 4000);
}

function resetBuildLog() {
  build.seq = 0;
  build.lines = [];
  build.offset = 0;
  build.pending = '';
  build.decoder = new StringDecoder('utf8');
}

/** 把日志文件里新写出的内容搬进 build.lines（增量、按行切） */
function pumpBuildLog() {
  let chunk = '';
  try {
    const size = fs.statSync(BUILD_LOG).size;
    if (size <= build.offset) return;
    const fd = fs.openSync(BUILD_LOG, 'r');
    try {
      const buf = Buffer.allocUnsafe(size - build.offset);
      fs.readSync(fd, buf, 0, buf.length, build.offset);
      build.offset = size;
      chunk = build.decoder.write(buf);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return;
  }
  if (!chunk) return;
  const parts = (build.pending + chunk).split(/\r?\n/);
  build.pending = parts.pop() || '';
  for (const line of parts) {
    if (line.trim() === '') continue;
    pushLine(line);
  }
}

function flushBuildLog() {
  pumpBuildLog();
  const rest = build.decoder.end();
  const tail = (build.pending + (rest || '')).trim();
  build.pending = '';
  if (tail) pushLine(tail);
}

function startBuild(mode) {
  if (build.running) return false;

  if (!BLOG_ROOT) {
    resetBuildLog();
    build.exit = -1;
    pushLine('✘ 未找到博客根目录');
    pushLine('请把本工具放在博客目录里，或用 --blog <博客根目录> 启动。');
    return false;
  }

  const isWin = process.platform === 'win32';
  const cmd =
    mode === 'clean'
      ? 'hexo clean'
      : mode === 'preview'
        ? 'hexo clean && hexo generate'
        : 'hexo clean && hexo generate -d';

  resetBuildLog();
  build.running = true;
  build.exit = null;
  build.startedAt = Date.now();
  pushLine(`$ ${cmd}`);

  let fd = null;
  try {
    fd = fs.openSync(BUILD_LOG, 'w'); // 同时清空上一轮日志
    const child = isWin
      ? spawn('cmd', ['/c', cmd], {
          cwd: BLOG_ROOT,
          windowsHide: true,
          // 关键：'ignore' + 文件描述符，全程不建管道
          stdio: ['ignore', fd, fd],
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        })
      : spawn('sh', ['-c', cmd], {
          cwd: BLOG_ROOT,
          stdio: ['ignore', fd, fd],
          env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
        });
    child.on('error', (err) => {
      flushBuildLog();
      build.running = false;
      build.exit = -1;
      pushLine('进程错误：' + err.message);
    });
    child.on('close', (code) => {
      flushBuildLog();
      build.running = false;
      build.exit = code;
      pushLine(
        code === 0
          ? '✔ 执行完成'
          : code === null
            ? '✘ 进程被终止'
            : `✘ 执行失败（退出码 ${code}）`
      );
    });
  } catch (err) {
    build.running = false;
    build.exit = -1;
    pushLine('启动失败：' + err.message + (err.code === 'EPERM' ? '（子进程创建被系统策略拒绝）' : ''));
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* 子进程已持有自己的句柄 */ }
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const p = url.pathname;
  const q = url.searchParams;

  if (p === '/api/ping') {
    return sendJson(res, 200, {
      ok: true,
      version: 1,
      blogRoot: BLOG_ROOT,
      blogRootFound: Boolean(BLOG_ROOT),
      postsDir: POSTS_DIR,
      postsDirExists: POSTS_DIR ? fs.existsSync(POSTS_DIR) : false,
      imgbedBase: CONFIG.imgbedBase,
      authCodeConfigured: Boolean(CONFIG.authCode),
      node: process.version,
    });
  }

  if (p === '/api/config') {
    return sendJson(res, 200, {
      imgbedBase: CONFIG.imgbedBase,
      postsDir: CONFIG.postsDir,
      returnFormat: CONFIG.returnFormat,
      imageInsertFormat: CONFIG.imageInsertFormat,
      authCodeConfigured: Boolean(CONFIG.authCode),
    });
  }

  if (p === '/api/posts' && req.method === 'GET') {
    if (!POSTS_DIR) return sendJson(res, 200, { posts: [], noBlogRoot: true });
    if (!fs.existsSync(POSTS_DIR)) return sendJson(res, 200, { posts: [] });
    const files = (await fsp.readdir(POSTS_DIR)).filter((f) => /\.md$/i.test(f));
    const posts = [];
    for (const f of files) {
      const full = path.join(POSTS_DIR, f);
      let st;
      try {
        st = await fsp.stat(full);
      } catch {
        continue;
      }
      let meta = { title: f.replace(/\.md$/i, ''), date: '' };
      try {
        const head = (await fsp.readFile(full, 'utf8')).slice(0, 2000);
        const fm = parseFrontMatter(head);
        if (fm.title) meta.title = fm.title;
        if (fm.date) meta.date = String(fm.date);
      } catch {
        /* 忽略 */
      }
      posts.push({ name: f, title: meta.title, date: meta.date, mtime: st.mtimeMs, size: st.size });
    }
    posts.sort((a, b) => b.mtime - a.mtime);
    return sendJson(res, 200, { posts });
  }

  if (p === '/api/post' && req.method === 'GET') {
    const full = safePostPath(q.get('name'));
    if (!full) return sendJson(res, 400, { error: '文件名非法' });
    try {
      const content = await fsp.readFile(full, 'utf8');
      return sendJson(res, 200, { name: path.basename(full), content });
    } catch {
      return sendJson(res, 404, { error: '文章不存在' });
    }
  }

  if (p === '/api/post' && req.method === 'POST') {
    if (!POSTS_DIR) return sendJson(res, 500, { error: '未找到博客目录，无法保存。请用 --blog <博客根目录> 重新启动。' });
    let payload;
    try {
      payload = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    } catch {
      return sendJson(res, 400, { error: '请求格式错误' });
    }
    let name = payload.name;
    if (!name) name = fileNameFromTitle(payload.title);
    const full = safePostPath(name);
    if (!full) return sendJson(res, 400, { error: '文件名非法（只能是 .md）' });
    await fsp.mkdir(POSTS_DIR, { recursive: true });
    const existing = fs.existsSync(full);
    if (existing && payload.overwrite === false) {
      return sendJson(res, 409, { error: '同名文件已存在', name: path.basename(full) });
    }
    await fsp.writeFile(full, String(payload.content ?? ''), 'utf8');
    return sendJson(res, 200, { ok: true, name: path.basename(full), created: !existing });
  }

  if (p === '/api/upload' && req.method === 'POST') {
    const filename = decodeURIComponent(req.headers['x-filename'] || 'image.png');
    const mime = req.headers['x-file-type'] || 'application/octet-stream';
    const authCode = String(req.headers['x-auth-code'] || '') || CONFIG.authCode;
    const base =
      String(req.headers['x-imgbed-base'] || '').trim().replace(/\/+$/, '') || CONFIG.imgbedBase;
    const folder = q.get('folder') || '';
    if (!base) {
      return sendJson(res, 400, {
        error: '还没有配置图床地址。点右上角「设置」，填入你的 CloudFlare-ImgBed 地址。',
        needConfig: 'imgbedBase',
      });
    }
    if (!/^https?:\/\//i.test(base)) {
      return sendJson(res, 400, { error: '图床地址必须以 http:// 或 https:// 开头：' + base });
    }
    const buffer = await readBody(req, 100 * 1024 * 1024);
    if (!buffer.length) return sendJson(res, 400, { error: '空文件' });
    const result = await uploadToImgbed({ buffer, filename, mime, authCode, folder, base });
    return sendJson(res, 200, { ok: true, ...result, filename, bytes: buffer.length });
  }

  if (p === '/api/build' && req.method === 'POST') {
    const mode = q.get('mode') || 'deploy';
    const started = startBuild(mode);
    return sendJson(res, 200, { started, running: build.running });
  }

  if (p === '/api/build/log') {
    const from = Number(q.get('from') || 0);
    pumpBuildLog();
    return sendJson(res, 200, {
      running: build.running,
      exit: build.exit,
      seq: build.seq,
      lines: from < build.seq ? build.lines.slice(-(build.seq - from)) : [],
    });
  }

  if (p === '/api/reload') {
    CONFIG = loadConfig();
    return sendJson(res, 200, { ok: true, authCodeConfigured: Boolean(CONFIG.authCode) });
  }

  return sendJson(res, 404, { error: '接口不存在' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/favicon.ico') return send(res, 204, '');
  const full = path.resolve(PUBLIC_DIR, '.' + rel);
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
    send(res, 200, data, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream' });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, url);
    }
  } catch (err) {
    const status = err.status || 500;
    if (!res.headersSent) sendJson(res, status, { error: err.message || '服务器错误' });
    else res.end();
  }
});

/* 端口占用时自动顺延 */
let tries = 0;
function listen(port) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && tries < 20) {
      tries++;
      listen(port + 1);
    } else {
      console.error('启动失败：', err.message);
      process.exit(1);
    }
  });
  server.listen(port, CONFIG.host, () => {
    const addr = `http://${CONFIG.host}:${port}/`;
    const isWin = process.platform === 'win32';
    console.log('');
    console.log('  写作台已启动  →  ' + addr);
    console.log('  博客目录      →  ' + (BLOG_ROOT || '✘ 未找到（请用 --blog <路径> 指定）'));
    console.log('  文章目录      →  ' + (POSTS_DIR || '—'));
    console.log(
      '  图床          →  ' +
        (CONFIG.imgbedBase || '未配置（可在界面「设置」里填写）') +
        (CONFIG.authCode ? '（已配置认证码）' : '')
    );
    console.log('');
    console.log('  关闭此窗口即可停止服务。');
    console.log('');
    if (ARGS.open) {
      try {
        if (isWin) {
          spawn('cmd', ['/c', 'start', '""', addr], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        } else if (process.platform === 'darwin') {
          spawn('open', [addr], { detached: true, stdio: 'ignore' }).unref();
        } else {
          spawn('xdg-open', [addr], { detached: true, stdio: 'ignore' }).unref();
        }
      } catch {
        /* 打不开就算了 */
      }
    }
  });
}

listen(ARGS.port || CONFIG.port);
