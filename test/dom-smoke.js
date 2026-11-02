/**
 * 无浏览器的冒烟测试：给 public/app.js 套一个最小 DOM，把 init() 真跑一遍。
 * 目的不是测样式，而是抓「元素 ID 拼错 / 初始化时抛异常」这类会让页面白屏的问题。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');

const IDS = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const CLASSES = new Set(
  [...html.matchAll(/\bclass="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
);
const DATASETS = new Set([...html.matchAll(/\b(data-[a-z-]+)/g)].map((m) => m[1]));

const missing = [];

function fake(tag = 'div', name = '') {
  const node = {
    tagName: tag.toUpperCase(),
    _name: name,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    hidden: false,
    checked: false,
    files: [],
    scrollTop: 0,
    scrollHeight: 100,
    clientHeight: 100,
    selectionStart: 0,
    selectionEnd: 0,
    style: {},
    dataset: {},
    children: [],
    lastElementChild: null,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined ? this._s.has(c) : !on) this._s.delete(c); else this._s.add(c); },
    },
    appendChild(c) { this.children.push(c); this.lastElementChild = c; return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    focus() {},
    click() {},
    setSelectionRange() {},
    setRangeText() {},
    dispatchEvent() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return null; },
  };
  return node;
}

const registry = new Map();
function byId(id) {
  if (!IDS.has(id)) { missing.push('#' + id); return undefined; }
  if (!registry.has(id)) registry.set(id, fake('div', id));
  return registry.get(id);
}

function querySelector(sel) {
  if (sel.startsWith('#')) return byId(sel.slice(1));
  if (sel.startsWith('.')) {
    const cls = sel.slice(1).split(/[.\s[:]/)[0];
    if (!CLASSES.has(cls) && !html.includes(cls)) { missing.push('.' + cls); return undefined; }
    const key = 'cls:' + cls;
    if (!registry.has(key)) registry.set(key, fake('div', cls));
    return registry.get(key);
  }
  return fake('div', sel);
}

function querySelectorAll(sel) {
  const m = /^\.([\w-]+)/.exec(sel);
  if (m) {
    const cls = m[1];
    const n = (html.match(new RegExp('\\b' + cls + '\\b', 'g')) || []).length || 1;
    const arr = Array.from({ length: n }, (_, i) => {
      const f = fake('button', cls + i);
      f.dataset = { act: 'bold', view: i === 1 ? 'split' : 'edit' };
      return f;
    });
    if (sel.includes('[data-act]')) return arr.map((f) => Object.assign(f, { dataset: { act: 'hr' } }));
    if (sel.includes('[data-view]')) return arr.map((f) => Object.assign(f, { dataset: { view: 'split' } }));
    if (sel.includes('[data-close-settings]')) return arr;
    return arr;
  }
  const d = /\[(data-[\w-]+)\]/.exec(sel);
  if (d) {
    const n = (html.match(new RegExp(d[1], 'g')) || []).length || 1;
    return Array.from({ length: n }, () => fake('button', d[1]));
  }
  return [];
}

const BASE = process.env.MDW_BASE || 'http://127.0.0.1:8787';
const fetchRel = (u, o) => fetch(String(u).startsWith('http') ? u : BASE + u, o);

const store = new Map();
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  requestAnimationFrame: (fn) => { void fn; return 0; },
  Event: class { constructor(t) { this.type = t; } },
  URL,
  JSON,
  Math,
  Date,
  Number,
  String,
  Array,
  Object,
  Error,
  fetch: fetchRel,
  navigator: { clipboard: { writeText: async () => {} } },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  marked: { setOptions() {}, parse: (s) => '<p>' + s + '</p>' },
  document: {
    documentElement: { dataset: {} },
    body: fake('body'),
    querySelector,
    querySelectorAll,
    getElementById: byId,
    createElement: (t) => fake(t),
    addEventListener() {},
  },
  window: {
    confirm: () => true,
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
  },
};
sandbox.window.document = sandbox.document;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

const ctx = vm.createContext(sandbox);

let failed = null;
process.on('unhandledRejection', (err) => { failed = failed || err; });
try {
  vm.runInContext(appSrc, ctx, { filename: 'app.js' });
} catch (err) {
  failed = err;
}

// 让 init() 里的 await 链跑完
setTimeout(() => {
  if (missing.length) {
    console.log('✘ 引用了 index.html 里不存在的选择器：');
    console.log('   ' + [...new Set(missing)].join(', '));
  } else {
    console.log('✔ 所有 querySelector / querySelectorAll 都能在 index.html 里找到');
  }
  if (failed) {
    console.log('✘ 启动即抛异常：' + (failed.stack || failed.message).split('\n').slice(0, 4).join('\n   '));
    process.exitCode = 1;
  } else {
    console.log('✔ app.js 在最小 DOM 下完成了 init()，无异常');
  }
}, 900);
