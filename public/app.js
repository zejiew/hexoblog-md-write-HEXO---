/* ==========================================================
   写作台 · 前端逻辑
   ========================================================== */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const LS = {
    imgbed: 'mdw:imgbedBase',
    auth: 'mdw:authCode',
    format: 'mdw:insertFormat',
    autocopy: 'mdw:autocopy',
    autosave: 'mdw:autosave',
    draft: 'mdw:draft',
    theme: 'mdw:theme',
    last: 'mdw:lastFile',
    view: 'mdw:view',
    attr: 'mdw:attrOpen',
  };

  const el = {
    title: $('#title'),
    filename: $('#filename'),
    tags: $('#tags'),
    categories: $('#categories'),
    date: $('#date'),
    editor: $('#editor'),
    preview: $('#preview'),
    panes: $('#panes'),
    postList: $('#post-list'),
    search: $('#search'),
    fileInput: $('#file-input'),
    saveState: $('#save-state'),
    statChars: $('#stat-chars'),
    statLines: $('#stat-lines'),
    uploadState: $('#upload-state'),
    imgbedState: $('#imgbed-state'),
    postCount: $('#post-count'),
    dropHint: $('#drop-hint'),
    editorPane: $('.editor-pane'),
    toasts: $('#toasts'),
    buildDrawer: $('#build-drawer'),
    buildLog: $('#build-log'),
    buildState: $('#build-state'),
    attrPanel: $('#attr-panel'),
    btnAttr: $('#btn-attr'),
    attrCount: $('#attr-count'),
    attrSummary: $('#attr-summary'),
  };

  const state = {
    cfg: null,
    posts: [],
    current: null,      // 当前文件名
    dirty: false,
    saving: false,
    extras: '',         // 未知的 front-matter 原文
    order: [],          // 已知字段在原文件里的出现顺序
    dateRaw: '',        // 文件里原始的 date 字符串（含时分秒）
    pickTarget: null,   // 正在为哪个字段选图（cover / top_img）
    uploading: 0,
    view: localStorage.getItem(LS.view) || 'split',
    buildSeq: 0,
    buildTimer: null,
  };

  const settings = {
    imgbedBase: localStorage.getItem(LS.imgbed) || '',
    authCode: localStorage.getItem(LS.auth) || '',
    format: localStorage.getItem(LS.format) || 'markdown',
    autocopy: localStorage.getItem(LS.autocopy) === '1',
    autosave: localStorage.getItem(LS.autosave) !== '0',
  };

  /** 生效的图床地址：本机设置优先，其次服务端 config */
  const imgbedBase = () => (settings.imgbedBase || state.cfg?.imgbedBase || '').replace(/\/+$/, '');

  /* ---------------------------------------------------------------- */
  /* 工具                                                              */
  /* ---------------------------------------------------------------- */

  let toastTimers = new WeakMap();

  function toast(message, type = 'info', duration = 2600) {
    const node = document.createElement('div');
    node.className = 'toast' + (type === 'error' ? ' err' : '');
    if (type === 'busy') {
      node.innerHTML = '<span class="spin"></span><span></span>';
      node.lastElementChild.textContent = message;
    } else {
      node.textContent = message;
    }
    el.toasts.appendChild(node);

    const close = () => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      node.style.transition = 'all .2s';
      setTimeout(() => node.remove(), 220);
    };
    if (type !== 'busy' && duration > 0) {
      const t = setTimeout(close, duration);
      toastTimers.set(node, t);
    }
    node.addEventListener('click', close);
    return { node, close };
  }

  function updateToast(handle, message, type) {
    if (type === 'error') handle.node.classList.add('err');
    const t = toastTimers.get(handle.node);
    if (t) clearTimeout(t);
    handle.node.innerHTML = '';
    handle.node.textContent = message;
    if (type === 'error') handle.node.classList.add('err');
    setTimeout(() => handle.close(), 2200);
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  function nowStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  function todayValue() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function slugify(title) {
    return String(title || '')
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '')
      .slice(0, 80);
  }

  const debounce = (fn, wait) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  };

  /* ---------------------------------------------------------------- */
  /* front-matter：字段表 + 纯函数解析 / 生成                          */
  /* ---------------------------------------------------------------- */
  /* 字段按 AnZhiYu 主题文档「页面配置 → Post Front-matter」整理。
     type 决定读文件时怎么解释、写回时怎么输出；表里没有的字段原样留在 extras 里，
     保存时按原文回写，不会被吃掉。 */

  const FIELDS = [
    { key: 'title', type: 'str' },
    { key: 'date', type: 'date' },
    { key: 'updated', type: 'str' },
    { key: 'tags', type: 'list' },
    { key: 'categories', type: 'list' },
    { key: 'keywords', type: 'list' },
    { key: 'description', type: 'str' },
    { key: 'top_img', type: 'img' },
    { key: 'cover', type: 'img' },
    { key: 'comments', type: 'bool' },
    { key: 'toc', type: 'bool' },
    { key: 'toc_number', type: 'bool' },
    { key: 'toc_style_simple', type: 'bool' },
    { key: 'copyright', type: 'bool' },
    { key: 'copyright_author', type: 'str' },
    { key: 'copyright_author_href', type: 'str' },
    { key: 'copyright_url', type: 'str' },
    { key: 'copyright_info', type: 'str' },
    { key: 'aside', type: 'bool' },
    { key: 'mathjax', type: 'bool' },
    { key: 'katex', type: 'bool' },
    { key: 'highlight_shrink', type: 'bool' },
    { key: 'aplayer', type: 'bool' },
    { key: 'swiper_index', type: 'num' },
    { key: 'top_group_index', type: 'num' },
    { key: 'background', type: 'str' },
  ];

  const TYPE = {};
  FIELDS.forEach((f) => { TYPE[f.key] = f.type; });

  const META_ONLY = ['title', 'date', 'tags', 'categories']; // 顶部 meta 栏里的四个

  function unquote(raw) {
    const t = String(raw == null ? '' : raw).trim();
    if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
      try { return JSON.parse(t); } catch { return t.slice(1, -1); }
    }
    if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1).replace(/''/g, "'");
    return t;
  }

  function toList(text) {
    const t = String(text || '').trim();
    if (!t) return [];
    const body = /^\[[\s\S]*\]$/.test(t) ? t.slice(1, -1) : t;
    return body.split(',').map((s) => unquote(s)).filter((s) => s !== '');
  }

  /** 原始文本 → JS 值；undefined 表示「这个字段没设置」 */
  function coerce(key, raw) {
    const type = TYPE[key];
    const t = String(raw == null ? '' : raw).trim();
    if (t === '') return undefined;

    if (type === 'list') return toList(t);
    if (type === 'bool') {
      const v = unquote(t).toLowerCase();
      if (['true', 'yes', 'on'].includes(v)) return true;
      if (['false', 'no', 'off'].includes(v)) return false;
      return undefined;
    }
    if (type === 'num') {
      const n = Number(unquote(t));
      return Number.isFinite(n) ? n : undefined;
    }
    if (type === 'img') {
      const v = unquote(t);
      if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true'; // cover: false 合法
      return v;
    }
    return unquote(t);
  }

  function parseFrontMatter(text) {
    const src = String(text || '').replace(/^\uFEFF/, ''); // 有些编辑器会写 BOM，Hexo 不在意，这里直接吃掉

    let m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(src);
    let block = m ? m[1] : null;
    let rest = m ? src.slice(m[0].length) : null;

    if (!m) {
      // 兼容缺了开头 --- 的旧文件（首行就是 title: …）：只在首行像 key: value
      // 且前 60 行内有独立 --- 行时才这么认，避免把普通文章的 --- 分隔线当 front-matter
      const lines = src.split(/\r?\n/);
      if (/^[A-Za-z_][\w-]*\s*:/.test(lines[0] || '')) {
        const end = lines.findIndex((l, i) => i > 0 && i < 60 && /^---[ \t]*$/.test(l));
        if (end > 0) {
          block = lines.slice(0, end).join('\n');
          rest = lines.slice(end + 1).join('\n');
        }
      }
    }
    if (block === null) return { data: {}, extras: '', order: [], body: src };

    const lines = block.split(/\r?\n/);
    const data = {};
    const order = [];
    const extras = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
      if (!kv || !(kv[1] in TYPE)) { extras.push(line); continue; }

      const key = kv[1];
      const rest2 = kv[2].trim();

      // 块状列表：key: 换行后跟 " - item"
      if (rest2 === '' && /^\s*-\s+/.test(lines[i + 1] || '')) {
        const arr = [];
        while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
          i++;
          arr.push(unquote(lines[i].replace(/^\s*-\s+/, '')));
        }
        const list = arr.filter((s) => s !== '');
        if (list.length) data[key] = list;
        if (!order.includes(key)) order.push(key);
        continue;
      }

      const v = coerce(key, rest2);
      if (v !== undefined) data[key] = v;
      if (!order.includes(key)) order.push(key);
    }

    while (extras.length && !extras[0].trim()) extras.shift();
    while (extras.length && !extras[extras.length - 1].trim()) extras.pop();

    return { data, extras: extras.join('\n'), order, body: rest };
  }

  const quoteStr = (s) => JSON.stringify(String(s)); // 一律双引号：中文、冒号、# 都安全

  function scalarLine(key, value) {
    const type = TYPE[key];
    if (type === 'bool' || type === 'img') {
      if (value === false || value === 'false') return 'false';
      if (value === true || value === 'true') return 'true';
    }
    if (type === 'num') {
      const n = Number(value);
      return Number.isFinite(n) ? String(n) : null;
    }
    return quoteStr(value);
  }

  function buildFrontMatter(data, extras, order) {
    const d = data || {};
    const lines = [];
    const seen = new Set();

    const push = (key, value) => {
      if (seen.has(key)) return;
      seen.add(key);
      if (Array.isArray(value)) {
        const arr = value.map((x) => String(x).trim()).filter(Boolean);
        if (arr.length) lines.push(`${key}: [${arr.map(quoteStr).join(', ')}]`);
        return;
      }
      if (value === undefined || value === null || value === '') return;
      const s = scalarLine(key, value);
      if (s === null) return;
      lines.push(`${key}: ${s}`);
    };

    push('title', d.title || '无标题');
    push('date', d.date || '');

    // 先按原文件顺序，再补上新增字段（字段表顺序）
    const rest = [];
    (order || []).forEach((k) => {
      if (k in TYPE && k !== 'title' && k !== 'date' && !rest.includes(k)) rest.push(k);
    });
    FIELDS.forEach((f) => {
      if (f.key !== 'title' && f.key !== 'date' && !rest.includes(f.key)) rest.push(f.key);
    });
    rest.forEach((k) => push(k, d[k]));

    const out = ['---'].concat(lines);
    const extra = String(extras || '').trim();
    if (extra) out.push(extra);
    out.push('---');
    return out.join('\n');
  }

  /* --------------------- front-matter ↔ 界面 --------------------- */

  function fmEl(key) {
    if (key === 'title') return el.title;
    if (key === 'date') return el.date;
    if (key === 'tags') return el.tags;
    if (key === 'categories') return el.categories;
    return $(`[data-fm="${key}"]`);
  }

  const splitList = (v) => String(v || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [String(v)]);

  function currentStamp() {
    const day = el.date.value || todayValue();
    const raw = String(state.dateRaw || '');
    if (raw && raw.slice(0, 10).replace(/\//g, '-') === day) return raw; // 没改日期就保留原时分秒
    return `${day} 00:00:00`;
  }

  function collectFields() {
    const d = { title: el.title.value.trim() || '无标题', date: currentStamp() };

    const tags = splitList(el.tags.value);
    if (tags.length) d.tags = tags;
    const cats = splitList(el.categories.value);
    if (cats.length) d.categories = cats;

    for (const f of FIELDS) {
      if (META_ONLY.includes(f.key)) continue;
      const node = fmEl(f.key);
      if (!node) continue;
      const raw = String(node.value || '').trim();
      if (raw === '') continue;

      if (f.type === 'bool') d[f.key] = raw === 'true';
      else if (f.type === 'num') {
        const n = Number(raw);
        if (Number.isFinite(n)) d[f.key] = n;
      } else if (f.type === 'list') {
        const arr = splitList(raw);
        if (arr.length) d[f.key] = arr;
      } else if (f.type === 'img') {
        d[f.key] = /^(true|false)$/i.test(raw) ? raw.toLowerCase() === 'true' : raw;
      } else {
        d[f.key] = raw;
      }
    }
    return d;
  }

  function applyFields(data) {
    const d = data || {};
    el.title.value = d.title || '';

    const stamp = String(d.date || '');
    state.dateRaw = stamp;
    const m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(stamp);
    el.date.value = m ? `${m[1]}-${pad2(m[2])}-${pad2(m[3])}` : todayValue();

    el.tags.value = asList(d.tags).join(', ');
    el.categories.value = asList(d.categories).join(', ');

    for (const f of FIELDS) {
      if (META_ONLY.includes(f.key)) continue;
      const node = fmEl(f.key);
      if (!node) continue;
      const v = d[f.key];
      if (f.type === 'bool') node.value = v === true ? 'true' : v === false ? 'false' : '';
      else if (Array.isArray(v)) node.value = v.join(', ');
      else node.value = v === undefined || v === null ? '' : String(v);
    }

    syncThumbs();
    paintAttrCount();
  }

  function composeDoc() {
    const body = el.editor.value.replace(/\s+$/, '');
    return `${buildFrontMatter(collectFields(), state.extras, state.order)}\n${body}\n`;
  }

  /* ---------------------------------------------------------------- */
  /* 文章属性面板                                                      */
  /* ---------------------------------------------------------------- */

  function syncThumb(key) {
    const node = fmEl(key);
    const img = el.attrPanel?.querySelector(`[data-thumb="${key}"]`);
    if (!node || !img) return;
    const v = String(node.value || '').trim();
    if (/^https?:\/\//i.test(v)) {
      if (img.getAttribute('src') !== v) img.src = v;
      img.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
    }
  }

  function syncThumbs() {
    syncThumb('cover');
    syncThumb('top_img');
  }

  function paintAttrCount() {
    if (!el.attrCount) return;
    const d = collectFields();
    const keys = Object.keys(d).filter((k) => !META_ONLY.includes(k));
    el.attrCount.textContent = String(keys.length);
    el.attrCount.hidden = keys.length === 0;
    el.attrCount.className = 'pill ' + (keys.length ? 'ok' : 'idle');

    const bits = [];
    if (d.cover) bits.push('封面');
    if (d.top_img) bits.push('顶部图');
    if (d.description) bits.push('摘要');
    if (d.swiper_index) bits.push('轮播 #' + d.swiper_index);
    if (d.top_group_index) bits.push('推荐 #' + d.top_group_index);
    if (d.copyright === false) bits.push('无版权块');
    if (d.toc === false) bits.push('无目录');
    if (el.attrSummary) el.attrSummary.textContent = bits.join(' · ');
  }

  function setAttrOpen(open) {
    if (!el.attrPanel) return;
    el.attrPanel.hidden = !open;
    el.btnAttr.setAttribute('aria-expanded', open ? 'true' : 'false');
    el.btnAttr.classList.toggle('open', open);
    localStorage.setItem(LS.attr, open ? '1' : '0');
  }

  async function uploadToField(file, key) {
    const label = key === 'cover' ? '封面' : '顶部图';
    const handle = toast(`上传${label}…`, 'busy');
    try {
      const data = await uploadOne(file);
      const node = fmEl(key);
      if (node) node.value = data.url;
      syncThumb(key);
      paintAttrCount();
      markDirty();
      updateToast(handle, `${data.elapsed ? (data.elapsed / 1000).toFixed(1) + 's · ' : ''}已设为${label}`, 'ok');
    } catch (err) {
      updateToast(handle, err.message, 'error');
      if (err.needConfig) openSettings();
    }
  }

  function genDescription() {
    const text = el.editor.value
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/^\s*#{1,6}\s+/gm, '')
      .replace(/[>*_`~|#-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) { toast('正文还是空的，先写点东西', 'error'); return; }
    const node = fmEl('description');
    if (!node) return;
    node.value = text.slice(0, 120) + (text.length > 120 ? '…' : '');
    paintAttrCount();
    markDirty();
    toast('摘要已生成，可以再改', 'ok');
  }

  /* ---------------------------------------------------------------- */
  /* 预览                                                              */
  /* ---------------------------------------------------------------- */

  marked.setOptions({ gfm: true, breaks: true, headerIds: true, mangle: true });

  const renderPreview = debounce(() => {
    const md = el.editor.value;
    if (!md.trim()) {
      el.preview.innerHTML = '<p class="empty-hint">左侧输入 Markdown，这里实时预览</p>';
      return;
    }
    try {
      el.preview.innerHTML = marked.parse(md);
    } catch (err) {
      el.preview.textContent = '预览出错：' + err.message;
    }
  }, 100);

  /* ---------------------------------------------------------------- */
  /* 状态栏                                                            */
  /* ---------------------------------------------------------------- */

  function setSaveState(text, cls = '') {
    el.saveState.textContent = text;
    el.saveState.className = 'status-item ' + cls;
  }

  function updateStats() {
    const v = el.editor.value;
    const chars = v.replace(/\s/g, '').length;
    const lines = v ? v.split(/\r?\n/).length : 0;
    el.statChars.textContent = `${chars} 字`;
    el.statLines.textContent = `${lines} 行`;
  }

  function markDirty() {
    state.dirty = true;
    setSaveState('● 未保存', 'dirty');
  }

  function markClean(label = '已保存') {
    state.dirty = false;
    setSaveState('✓ ' + label, 'saved');
  }

  /* ---------------------------------------------------------------- */
  /* 编辑器操作                                                        */
  /* ---------------------------------------------------------------- */

  function insertText(text, opts = {}) {
    const ta = el.editor;
    ta.focus();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const atLineStart = start === 0 || before.endsWith('\n');

    let payload = text;
    if (opts.block && !atLineStart) payload = '\n' + payload;
    if (opts.block) payload = payload + '\n';

    ta.value = before + payload + after;
    const pos = start + payload.length;
    ta.setSelectionRange(pos, pos);
    ta.dispatchEvent(new Event('input'));
  }

  function wrapSelection(left, right = left, placeholder = '') {
    const ta = el.editor;
    ta.focus();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = ta.value.slice(start, end) || placeholder;

    const next = ta.value.slice(0, start) + left + selected + right + ta.value.slice(end);
    ta.value = next;

    const selStart = start + left.length;
    ta.setSelectionRange(selStart, selStart + selected.length);
    ta.dispatchEvent(new Event('input'));
  }

  function prefixLines(prefix, numbered = false) {
    const ta = el.editor;
    ta.focus();
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const lineStart = ta.value.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = ta.value.indexOf('\n', end);
    const block = ta.value.slice(lineStart, lineEnd === -1 ? ta.value.length : lineEnd);

    const out = block
      .split('\n')
      .map((line, i) => {
        const p = numbered ? `${i + 1}. ` : prefix;
        return line.startsWith(p) ? line.slice(p.length) : p + line.replace(/^(#{1,6}\s+|>\s+|[-*]\s+|\d+\.\s+)/, '');
      })
      .join('\n');

    ta.value = ta.value.slice(0, lineStart) + out + ta.value.slice(lineEnd === -1 ? ta.value.length : lineEnd);
    ta.setSelectionRange(lineStart, lineStart + out.length);
    ta.dispatchEvent(new Event('input'));
  }

  const ACTIONS = {
    h1: () => prefixLines('# '),
    h2: () => prefixLines('## '),
    h3: () => prefixLines('### '),
    bold: () => wrapSelection('**', '**', '粗体'),
    italic: () => wrapSelection('*', '*', '斜体'),
    strike: () => wrapSelection('~~', '~~', '删除线'),
    quote: () => prefixLines('> '),
    ul: () => prefixLines('- '),
    ol: () => prefixLines('1. ', true),
    code: () => wrapSelection('`', '`', 'code'),
    codeblock: () => insertText('```\n\n```', { block: true }),
    link: () => {
      const ta = el.editor;
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (/^https?:\/\//.test(sel)) wrapSelection('[', '](此处填标题)', sel);
      else wrapSelection('[', '](https://)', sel || '链接文字');
    },
    table: () =>
      insertText('| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |', { block: true }),
    hr: () => insertText('---', { block: true }),
    more: () => insertText('<!-- more -->', { block: true }),
  };

  /* ---------------------------------------------------------------- */
  /* 图片上传                                                          */
  /* ---------------------------------------------------------------- */

  function buildImageMarkdown(url, alt) {
    switch (settings.format) {
      case 'html':
        return `<img src="${url}" alt="${alt}" />`;
      case 'url':
        return url;
      case 'markdown':
      default:
        return `![${alt}](${url})`;
    }
  }

  function stripExt(name) {
    return String(name || 'image').replace(/\.[a-z0-9]+$/i, '');
  }

  async function uploadOne(file) {
    const base = imgbedBase();
    if (!base) {
      const err = new Error('还没有配置图床地址，点右上角齿轮「设置」填写');
      err.needConfig = true;
      throw err;
    }
    const headers = {
      'X-Filename': encodeURIComponent(file.name || 'image.png'),
      'X-File-Type': file.type || 'application/octet-stream',
      'X-Imgbed-Base': base,
    };
    if (settings.authCode) headers['X-Auth-Code'] = settings.authCode;

    const res = await fetch(`/api/upload?name=${encodeURIComponent(file.name || '')}`, {
      method: 'POST',
      headers,
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `上传失败 (${res.status})`);
    return data;
  }

  async function handleFiles(fileList) {
    const files = [...fileList].filter((f) => f && f.type && f.type.startsWith('image/'));
    if (!files.length) return;

    state.uploading += files.length;
    const total = files.length;
    let done = 0;
    el.uploadState.textContent = `上传中 0/${total}`;

    for (const file of files) {
      const handle = toast(`上传中 ${file.name || '截图'}`, 'busy');
      try {
        const data = await uploadOne(file);
        done++;
        el.uploadState.textContent = `上传中 ${done}/${total}`;
        updateToast(handle, `${data.elapsed ? (data.elapsed / 1000).toFixed(1) + 's · ' : ''}已插入链接`, 'ok');
        insertText(buildImageMarkdown(data.url, stripExt(file.name)), { block: true });
        if (settings.autocopy) {
          navigator.clipboard?.writeText(data.url).catch(() => {});
        }
      } catch (err) {
        done++;
        el.uploadState.textContent = `上传中 ${done}/${total}`;
        updateToast(handle, err.message, 'error');
        if (err.needConfig) openSettings();
      }
    }

    state.uploading = 0;
    setTimeout(() => { el.uploadState.textContent = ''; }, 1500);
  }

  /* ---------------------------------------------------------------- */
  /* 文章列表                                                          */
  /* ---------------------------------------------------------------- */

  async function loadPosts() {
    try {
      const res = await fetch('/api/posts');
      const data = await res.json();
      state.posts = data.posts || [];
      renderPostList();
    } catch {
      toast('读取文章列表失败', 'error');
    }
  }

  function renderPostList() {
    const kw = el.search.value.trim().toLowerCase();
    const list = state.posts.filter((p) => !kw || p.title.toLowerCase().includes(kw) || p.name.toLowerCase().includes(kw));

    el.postCount.textContent = `${state.posts.length} 篇`;
    el.postList.innerHTML = '';

    if (!list.length) {
      el.postList.innerHTML = '<div class="muted small" style="padding:14px 10px">还没有文章，点「新建」开始写吧</div>';
      return;
    }

    for (const post of list) {
      const btn = document.createElement('button');
      btn.className = 'post-item' + (post.name === state.current ? ' active' : '');
      btn.dataset.name = post.name;
      const t = document.createElement('span');
      t.className = 'pi-title';
      t.textContent = post.title || post.name;
      const d = document.createElement('span');
      d.className = 'pi-date';
      d.textContent = (post.date || '').slice(0, 10) || new Date(post.mtime).toLocaleDateString('zh-CN');
      btn.append(t, d);
      btn.addEventListener('click', () => openPost(post.name));
      el.postList.appendChild(btn);
    }
  }

  /* ---------------------------------------------------------------- */
  /* 打开 / 新建 / 保存                                                */
  /* ---------------------------------------------------------------- */

  function confirmDiscard() {
    if (!state.dirty) return true;
    return window.confirm('当前文章有未保存的修改，确定要放弃吗？');
  }

  function applyDoc(name, text) {
    const { data, extras, order, body } = parseFrontMatter(text);
    state.current = name;
    state.extras = extras;
    state.order = order;

    el.filename.value = name || '';
    applyFields(data);
    if (!el.title.value) el.title.value = (name || '').replace(/\.md$/i, '');

    el.editor.value = body.replace(/^\s*\n/, '');
    renderPreview();
    updateStats();
    markClean('已打开');
    renderPostList();
    localStorage.setItem(LS.last, name || '');
  }

  async function openPost(name) {
    if (!confirmDiscard()) return;
    try {
      const res = await fetch(`/api/post?name=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '打开失败');
      applyDoc(data.name, data.content);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  function newPost() {
    if (!confirmDiscard()) return;
    state.current = null;
    state.extras = '';
    state.order = [];
    state.dateRaw = '';
    el.title.value = '';
    el.filename.value = '';
    el.editor.value = '';
    applyFields({ date: `${todayValue()} 00:00:00` });
    el.editor.focus();
    renderPreview();
    updateStats();
    setSaveState('新文章（未保存）');
    state.dirty = false;
    renderPostList();
  }

  function ensureFilename() {
    let name = el.filename.value.trim();
    if (!name) {
      name = slugify(el.title.value) + '.md';
      el.filename.value = name;
    }
    if (!/\.md$/i.test(name)) name += '.md';
    return name;
  }

  async function savePost() {
    if (state.saving) return;
    state.saving = true;
    setSaveState('保存中…', 'busy');

    const name = ensureFilename();
    try {
      const res = await fetch('/api/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content: composeDoc(), overwrite: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存失败');

      state.current = data.name;
      el.filename.value = data.name;
      state.dirty = false;
      markClean(data.created ? '已创建' : '已保存');
      localStorage.setItem(LS.last, data.name);
      localStorage.removeItem(LS.draft);
      toast(data.created ? `已创建 ${data.name}` : `已保存 ${data.name}`, 'ok');
      await loadPosts();
    } catch (err) {
      setSaveState('保存失败', 'dirty');
      toast(err.message, 'error');
    } finally {
      state.saving = false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* 草稿                                                              */
  /* ---------------------------------------------------------------- */

  function saveDraft() {
    if (!settings.autosave || !state.dirty) return;
    try {
      localStorage.setItem(
        LS.draft,
        JSON.stringify({
          v: 2,
          name: state.current,
          fields: collectFields(),
          order: state.order,
          extras: state.extras,
          dateRaw: state.dateRaw,
          body: el.editor.value,
          ts: Date.now(),
        })
      );
    } catch { /* 存储满就算了 */ }
  }

  function offerDraftRestore() {
    let draft;
    try {
      draft = JSON.parse(localStorage.getItem(LS.draft) || 'null');
    } catch { draft = null; }
    if (!draft || !draft.body || !draft.body.trim()) return;
    if (draft.name && draft.name === state.current) return;

    const { node, close } = toast('发现未保存的草稿', 'info', 0);
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.style.cssText = 'height:24px;padding:0 10px;font-size:12px;margin-left:6px';
    btn.textContent = '恢复';
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.current = draft.name || null;
      state.extras = draft.extras || '';
      state.order = Array.isArray(draft.order) ? draft.order : [];
      state.dateRaw = draft.dateRaw || '';
      el.filename.value = draft.name || '';

      if (draft.fields && typeof draft.fields === 'object') {
        applyFields(draft.fields);
      } else {
        // 旧格式草稿
        el.title.value = draft.title || '';
        el.tags.value = draft.tags || '';
        el.categories.value = draft.categories || '';
        el.date.value = draft.date || todayValue();
      }

      el.editor.value = draft.body;
      renderPreview();
      updateStats();
      markDirty();
      close();
      toast('草稿已恢复，记得按 Ctrl+S 保存', 'ok');
    });
    const drop = document.createElement('button');
    drop.className = 'link-btn';
    drop.style.cssText = 'color:#fff;opacity:.7;margin-left:4px';
    drop.textContent = '丢弃';
    drop.addEventListener('click', (ev) => {
      ev.stopPropagation();
      localStorage.removeItem(LS.draft);
      close();
    });
    node.append(btn, drop);
  }

  /* ---------------------------------------------------------------- */
  /* 构建 / 发布                                                       */
  /* ---------------------------------------------------------------- */

  async function startBuild(mode = 'deploy') {
    el.buildDrawer.hidden = false;
    el.buildLog.textContent = '';
    el.buildState.textContent = '运行中';
    el.buildState.className = 'pill idle';
    state.buildSeq = 0;

    try {
      await fetch(`/api/build?mode=${mode}`, { method: 'POST' });
    } catch {
      toast('无法启动构建', 'error');
      return;
    }

    clearInterval(state.buildTimer);
    state.buildTimer = setInterval(async () => {
      try {
        const res = await fetch(`/api/build/log?from=${state.buildSeq}`);
        const data = await res.json();
        if (data.lines.length) {
          state.buildSeq = data.seq;
          el.buildLog.textContent += data.lines.join('\n') + '\n';
          el.buildLog.scrollTop = el.buildLog.scrollHeight;
        }
        if (!data.running) {
          clearInterval(state.buildTimer);
          const ok = data.exit === 0;
          el.buildState.textContent = ok ? '完成' : `失败 (${data.exit})`;
          el.buildState.className = 'pill ' + (ok ? 'ok' : 'bad');
          toast(ok ? '构建完成' : '构建失败，看日志', ok ? 'ok' : 'error');
        }
      } catch { /* 忽略单次失败 */ }
    }, 700);
  }

  /* ---------------------------------------------------------------- */
  /* 设置 / 主题                                                       */
  /* ---------------------------------------------------------------- */

  function openSettings() {
    $('#cfg-imgbed').value = settings.imgbedBase || state.cfg?.imgbedBase || '';
    $('#cfg-authcode').value = settings.authCode;
    $('#cfg-format').value = settings.format;
    $('#cfg-autocopy').checked = settings.autocopy;
    $('#cfg-autosave').checked = settings.autosave;
    $('#settings-mask').hidden = false;
    setTimeout(() => $('#cfg-imgbed').focus(), 30);
  }

  function closeSettings() {
    $('#settings-mask').hidden = true;
  }

  function saveSettings() {
    let base = $('#cfg-imgbed').value.trim().replace(/\/+$/, '');
    if (base && !/^https?:\/\//i.test(base)) base = 'https://' + base;
    settings.imgbedBase = base;
    settings.authCode = $('#cfg-authcode').value.trim();
    settings.format = $('#cfg-format').value;
    settings.autocopy = $('#cfg-autocopy').checked;
    settings.autosave = $('#cfg-autosave').checked;

    localStorage.setItem(LS.imgbed, settings.imgbedBase);
    localStorage.setItem(LS.auth, settings.authCode);
    localStorage.setItem(LS.format, settings.format);
    localStorage.setItem(LS.autocopy, settings.autocopy ? '1' : '0');
    localStorage.setItem(LS.autosave, settings.autosave ? '1' : '0');

    closeSettings();
    paintImgbedState();
    toast(settings.imgbedBase ? '设置已保存' : '设置已保存（图床地址为空）', 'ok');
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(LS.theme, theme);
  }

  function setView(view) {
    state.view = view;
    el.panes.dataset.view = view;
    localStorage.setItem(LS.view, view);
    $$('.vs').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  }

  /* ---------------------------------------------------------------- */
  /* 事件绑定                                                          */
  /* ---------------------------------------------------------------- */

  function bind() {
    // 编辑
    el.editor.addEventListener('input', () => {
      markDirty();
      updateStats();
      renderPreview();
    });

    el.editor.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); savePost(); return; }
      if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); ACTIONS.bold(); return; }
      if (mod && e.key.toLowerCase() === 'i') { e.preventDefault(); ACTIONS.italic(); return; }
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); ACTIONS.link(); return; }
      if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newPost(); return; }
      if (e.key === 'Tab') {
        e.preventDefault();
        const ta = el.editor;
        if (ta.selectionStart !== ta.selectionEnd) {
          prefixLines('  ');
        } else {
          const pos = ta.selectionStart;
          ta.setRangeText('  ', pos, pos, 'end');
          ta.dispatchEvent(new Event('input'));
        }
      }
    });

    // 粘贴图片
    el.editor.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData?.items || [])];
      const files = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile());
      if (files.length) {
        e.preventDefault();
        handleFiles(files);
      }
    });

    // 拖拽
    let dragDepth = 0;
    ['dragenter', 'dragover'].forEach((evt) =>
      el.editorPane.addEventListener(evt, (e) => {
        e.preventDefault();
        if (evt === 'dragenter') dragDepth++;
        el.editorPane.classList.add('dragging');
      })
    );
    el.editorPane.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) el.editorPane.classList.remove('dragging');
    });
    el.editorPane.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      el.editorPane.classList.remove('dragging');
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    // 工具栏
    $$('.tb[data-act]').forEach((btn) => {
      btn.addEventListener('click', () => ACTIONS[btn.dataset.act]?.());
    });

    // 视图切换
    $$('.vs').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));

    // 顶栏
    $('#btn-new').addEventListener('click', newPost);
    $('#btn-save').addEventListener('click', savePost);
    $('#btn-deploy').addEventListener('click', async () => {
      if (!window.confirm('将执行：hexo clean && hexo generate -d\n\n确认发布到站点？')) return;
      if (state.dirty) {
        toast('正在保存当前文章…', 'busy');
        await savePost();
      }
      if (state.dirty) return;
      startBuild('deploy');
    });
    $('#btn-settings').addEventListener('click', openSettings);
    $('#btn-theme').addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
    $('#btn-refresh').addEventListener('click', loadPosts);
    el.search.addEventListener('input', debounce(renderPostList, 120));

    // 标题 → 文件名
    let filenameTouched = false;
    el.filename.addEventListener('input', () => { filenameTouched = true; });
    el.title.addEventListener('input', () => {
      if (!filenameTouched) el.filename.value = slugify(el.title.value) + '.md';
      markDirty();
    });
    [el.tags, el.categories, el.date].forEach((input) => input.addEventListener('input', markDirty));

    // 文章属性面板
    el.btnAttr.addEventListener('click', () => setAttrOpen(!!el.attrPanel.hidden));
    el.attrPanel.addEventListener('input', (e) => {
      const key = e.target.dataset?.fm;
      if (!key) return;
      markDirty();
      if (key === 'cover' || key === 'top_img') syncThumb(key);
      paintAttrCount();
    });
    el.attrPanel.addEventListener('change', (e) => {
      const key = e.target.dataset?.fm;
      if (!key) return;
      markDirty();
      paintAttrCount();
    });
    el.attrPanel.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.pick) {
        state.pickTarget = btn.dataset.pick;
        el.fileInput.click();
        return;
      }
      if (btn.dataset.clear) {
        const key = btn.dataset.clear;
        const node = fmEl(key);
        if (node) node.value = '';
        syncThumb(key);
        paintAttrCount();
        markDirty();
        return;
      }
      if (btn.dataset.copyTo) {
        const from = fmEl(btn.dataset.from);
        const to = fmEl(btn.dataset.copyTo);
        if (from && to) {
          to.value = from.value;
          syncThumb(btn.dataset.copyTo);
          paintAttrCount();
          markDirty();
        }
        return;
      }
      if (btn.id === 'btn-gen-desc') genDescription();
    });

    // 上传（工具栏按钮 / 属性面板里的「上传」）
    $('#btn-upload').addEventListener('click', () => {
      state.pickTarget = null;
      el.fileInput.click();
    });
    el.fileInput.addEventListener('change', () => {
      const files = el.fileInput.files;
      const target = state.pickTarget;
      state.pickTarget = null;
      if (target && files[0]) uploadToField(files[0], target);
      else handleFiles(files);
      el.fileInput.value = '';
    });

    // 设置
    $$('[data-close-settings]').forEach((b) => b.addEventListener('click', closeSettings));
    $('#settings-mask').addEventListener('click', (e) => {
      if (e.target === $('#settings-mask')) closeSettings();
    });
    $('#btn-save-settings').addEventListener('click', saveSettings);

    // 复制全文
    $('#btn-copy').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(composeDoc());
        toast('已复制全文', 'ok');
      } catch {
        toast('复制失败，请手动选择', 'error');
      }
    });

    // 构建日志
    $('#btn-close-drawer').addEventListener('click', () => {
      el.buildDrawer.hidden = true;
      clearInterval(state.buildTimer);
    });

    // 预览滚动同步
    let syncing = false;
    const previewPane = $('.preview-pane');
    el.editor.addEventListener('scroll', () => {
      if (syncing || state.view !== 'split') return;
      syncing = true;
      const ratio = el.editor.scrollTop / Math.max(1, el.editor.scrollHeight - el.editor.clientHeight);
      previewPane.scrollTop = ratio * (previewPane.scrollHeight - previewPane.clientHeight);
      requestAnimationFrame(() => { syncing = false; });
    });

    // 离开保护
    window.addEventListener('beforeunload', (e) => {
      saveDraft();
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    // 全局快捷键
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePost();
      }
      if (e.key === 'Escape') closeSettings();
    });

    setInterval(saveDraft, 3000);
  }

  /* ---------------------------------------------------------------- */
  /* 启动                                                              */
  /* ---------------------------------------------------------------- */

  /** 右上角「图床」小徽章 */
  let pingInfo = {};
  function paintImgbedState() {
    const base = imgbedBase();
    const hasCode = Boolean(pingInfo.authCodeConfigured || settings.authCode);

    if (!base) {
      el.imgbedState.textContent = '未配置图床';
      el.imgbedState.className = 'pill bad';
      el.imgbedState.title = '点开「设置」填入你的图床地址';
      return;
    }

    let host = base;
    try {
      host = new URL(base).host;
    } catch {
      /* 保留原文 */
    }
    el.imgbedState.textContent = host;
    el.imgbedState.className = 'pill ' + (hasCode ? 'ok' : 'idle');
    el.imgbedState.title = hasCode
      ? '图床已就绪：' + base
      : '已配置图床地址；如果上传被拒（401），到「设置」填认证码';
  }

  async function init() {
    applyTheme(localStorage.getItem(LS.theme) || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    setView(state.view);

    try {
      const res = await fetch('/api/config');
      state.cfg = await res.json();
    } catch {
      state.cfg = {};
    }

    try {
      const res = await fetch('/api/ping');
      pingInfo = await res.json();
    } catch {
      pingInfo = {};
      el.imgbedState.textContent = '服务未连通';
      el.imgbedState.className = 'pill bad';
    }

    paintImgbedState();

    if (pingInfo.ok && !pingInfo.blogRootFound) {
      toast('没找到博客目录，无法读写文章（可用 --blog 指定）', 'error', 6000);
    } else if (pingInfo.ok && !imgbedBase()) {
      setTimeout(() => toast('还没配置图床地址，点右上角齿轮填写', 'error', 5000), 400);
    } else if (pingInfo.ok && !pingInfo.authCodeConfigured && !settings.authCode) {
      toast('图床地址已就绪；若上传提示 401，到设置里填认证码', 'info', 4500);
    }

    await loadPosts();

    const last = localStorage.getItem(LS.last);
    if (last && state.posts.some((p) => p.name === last)) {
      await openPost(last);
    } else {
      newPost();
      state.dirty = false;
    }

    bind();
    setAttrOpen(localStorage.getItem(LS.attr) === '1');
    renderPreview();
    offerDraftRestore();
  }

  init();
})();
