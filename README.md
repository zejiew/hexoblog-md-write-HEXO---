# 写作台 · Markdown + 自建图床

一个跑在本机的 Markdown 写稿工具。**粘贴或拖入图片 → 自动上传到你的图床 → 链接直接落回光标处**，写完点一下就能生成并发布博客。

为 [Hexo](https://hexo.io/) 设计（直接读写 `source/_posts`、一键 `hexo clean && hexo g -d`），图床端对接 [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed)（也就是 Sanyue ImgHub）。

- **零依赖**：只要 Node.js 18+，不用 `npm install`，不连任何 CDN
- **图片不落地**：剪贴板里的截图直接进图床，博客仓库里不留一堆 `images/` 文件夹
- **图床随便换**：地址和认证码都填在你自己的机器上（浏览器 localStorage 或本地配置文件），仓库里是空的

---

## 功能

| 功能 | 说明 |
| --- | --- |
| 文章列表 | 列出 `source/_posts/*.md`，标题取 front-matter，按修改时间排序，支持搜索 |
| 新建 / 打开 / 保存 | 保存即写回 `source/_posts/文件名.md`，Ctrl+S 随手存 |
| 实时预览 | marked 渲染，参数按 `hexo-renderer-marked` 默认值（`gfm`/`breaks`/`headerIds`/`mangle`）设置，预览≈站点实际效果 |
| 贴图上传 | 三种方式：Ctrl+V 粘贴截图、把图片拖进编辑区、点工具栏「插入图片」 |
| 插入格式 | `![alt](url)` / `<img src>` / 纯链接，设置里可切换；可勾选「上传后自动复制链接」 |
| 工具栏 | H1–H3、粗体/斜体/删除线、引用、有序无序列表、行内代码、代码块、链接、表格、分割线 |
| 视图 | 编辑 / 分栏 / 纯预览 三态，滚动同步 |
| 发布 | 先保存当前文章，再执行 `hexo clean && hexo generate -d`，构建日志在右下角抽屉里实时滚动 |
| 草稿保护 | 每 3 秒把未保存内容存 localStorage，误关页面后下次打开可恢复 |
| 主题 | 顶栏月亮图标切换明 / 暗 |

---

## 快速开始

需要 **Node.js 18 或更高**（`node -v` 看一下）。

1. 把这个目录放到你的博客仓库里，比如 `博客根目录/tools/md-writer/`
2. 双击 `启动写作台.bat`（Windows），或命令行：

   ```bash
   # Windows
   node tools\md-writer\server.js --open

   # macOS / Linux
   sh tools/md-writer/start.sh
   ```

3. 浏览器会打开 `http://127.0.0.1:8787/`。第一次进去先点右上角 ⚙️ **设置**，填图床地址（见下一节）

控制台会打印实际地址和它找到的博客目录：

```
  写作台已启动  →  http://127.0.0.1:8787/
  博客目录      →  D:\my-blog
  文章目录      →  D:\my-blog\source\_posts
  图床          →  https://img.example.com
```

端口被占用会自动顺延（8788、8789…），以控制台打印的为准。关掉那个黑窗口即停止服务。

### 放在别处也行

工具会自动向上寻找博客根目录（有 `_config.yml` + `source/_posts` 的那个目录）。如果你的博客结构不一样，或想把工具放在博客外面，用参数指定：

```bash
node server.js --blog D:\my-blog
node server.js --blog /home/me/blog --port 8899
```

---

## 接入你自己的图床

本项目的上传逻辑是按 **CloudFlare-ImgBed（Sanyue ImgHub）** 的 `/upload` 接口写的。

### 1. 先有一个 CloudFlare-ImgBed

如果还没有，按官方文档部署一个（Cloudflare Pages / Workers / Docker 都行，存储可选 Telegram、Cloudflare R2、S3、Discord、Hugging Face、WebDAV）：

- 文档：<https://cfbed.sanyue.de/>
- 仓库：<https://github.com/MarSeventh/CloudFlare-ImgBed>

部署完你会得到一个站点地址，形如 `https://img.yourdomain.com` 或 `https://xxx.pages.dev`。

### 2. 记下两样东西

| 需要的 | 在哪拿 | 示例 |
| --- | --- | --- |
| **站点地址** | 部署出来的域名 | `https://img.yourdomain.com` |
| **认证码**（可选） | 图床后台 → 系统设置 → 安全设置 → 上传认证码 | `my-secret-code` |

> 图床后台如果**没有**设置认证码，这里就留空；设置了就必须填对，否则上传返回 `401`。

### 3. 填进写作台

两种方式，任选其一（**推荐第一种**，改起来不用重启）：

**A. 界面里填**（存浏览器 localStorage，只影响你这台机器）

右上角 ⚙️ 设置 → 图床地址 / 上传认证码 → 保存。

**B. 写进配置文件**（适合固定环境，也让 curl 调接口时能直接用）

```bash
cp config.local.example.json config.local.json
```

```json
{
  "imgbedBase": "https://img.yourdomain.com",
  "authCode": "my-secret-code"
}
```

`config.local.json` 已在 `.gitignore` 里，不会被提交。
优先级：**界面设置 > `config.local.json` > `config.json`**。改完配置文件需要重启服务（或访问 `http://127.0.0.1:8787/api/reload`）。

### 4. 验证

拖一张图片进编辑区。成功的话：

- 右上角徽章显示你的图床域名
- 光标处出现 `![图片名](https://img.yourdomain.com/file/xxx.png)`
- 打开图床后台，能看到这张图

失败时看提示：

| 提示 | 原因 |
| --- | --- |
| `还没有配置图床地址…` | 设置里没填，或填了但没保存 |
| `图床返回 401` | 认证码不对，或图床开了认证码而你留空了 |
| `图床返回 404` | 地址填错了（常见是填成了 `https://xxx/upload`，只填到域名） |
| `图床返回 400 … UPLOAD_FORMAT_NOT_ALLOWED` | 图床后台没允许 png/jpg，去「上传格式」里加上 |
| `无法连接图床：请求超时` | 网络到 Cloudflare 不稳，服务端超时 90 秒；先试试图床网页版能否上传 |

### 想用别的图床？

只要它的接口长得差不多（`multipart/form-data` 里一个 `file` 字段，返回 JSON 里有图片链接），改 `server.js` 里的 `uploadToImgbed()` 一个函数即可，前端不用动。PicGo、兰空图床、S3 兼容存储之类都有人这么接。

---

## 配置项

`config.json`（仓库里的默认值，可以提交）：

```json
{
  "port": 8787,
  "host": "127.0.0.1",

  "imgbedBase": "",
  "authCode": "",
  "uploadChannel": "",
  "returnFormat": "full",

  "blogRoot": "",
  "postsDir": "source/_posts",
  "imageInsertFormat": "markdown"
}
```

| 键 | 说明 |
| --- | --- |
| `port` / `host` | 监听地址，默认只绑 `127.0.0.1`（**别改成 0.0.0.0**，这个服务没有登录鉴权） |
| `imgbedBase` | 图床站点根地址，**留空**，由使用者自己填 |
| `authCode` | 图床上传认证码，留空表示图床不校验 |
| `uploadChannel` | 图床渠道：`telegram` / `cfr2` / `s3` / `discord` / `huggingface` / `webdav`，留空用图床默认 |
| `returnFormat` | `full` 返回完整链接；`default` 返回 `/file/xxx` 相对路径 |
| `blogRoot` | 博客根目录；留空则自动向上查找 |
| `postsDir` | 文章目录，相对博客根目录；非 Hexo 的纯 Markdown 博客改这里即可 |
| `imageInsertFormat` | 默认插入格式，界面上还能再改 |

---

## 快捷键

| 按键 | 作用 |
| --- | --- |
| `Ctrl+S` | 保存 |
| `Ctrl+N` | 新建 |
| `Ctrl+B` / `Ctrl+I` | 粗体 / 斜体 |
| `Ctrl+K` | 插入链接 |
| `Tab` | 缩进两空格（有选区时给每行加缩进） |
| `Ctrl+V` | 剪贴板里是图片就直接上传 |
| `Esc` | 关闭设置弹窗 |

---

## 为什么要起一个本地服务？

**因为浏览器不能直接往图床发 POST。**

实测 CloudFlare-ImgBed（Cloudflare Pages 部署）的跨域行为：

- `OPTIONS` 预检：返回 200/405，**带** `access-control-allow-origin: *`
- `POST /upload`：响应**没有任何** `access-control-*` 头

也就是说图片其实传上去了，但浏览器拿不到响应体，读不到图片链接。所以必须有一层同源的本地代理：

```
浏览器 (File)
   │  POST /api/upload        同源，无跨域
   ▼
server.js  ──FormData(file)──▶  POST {图床}/upload?authCode=…&returnFormat=full
   ▲                                        │
   └──────── { url: "https://…/file/x.png" } ┘
```

顺带的好处：认证码留在本机、可以给图片加 `uploadFolder`、上传失败能拿到真实状态码。

### 图床接口契约（实测 + [官方文档](https://cfbed.sanyue.de/api/upload.html)）

```
POST {imgbedBase}/upload?authCode=<认证码>&returnFormat=full&responseFormat=object
Content-Type: multipart/form-data
体：file=<二进制>

200 → [{ "src": "https://…/file/1793657117032_name.png" }]     // 数组
      或 { "src": "…" }                                        // 加 responseFormat=object 且版本支持时
401 → Unauthorized（认证码错）
400 → { code: "UPLOAD_FORMAT_NOT_ALLOWED" }
```

代码对数组和对象两种返回都做了兼容（不同版本行为不一致）。

### 发布日志是怎么拿到的

最初用 `spawn('cmd', [...], { stdio: 'pipe' })` 收 hexo 输出，在某些受限环境下直接抛 `spawn EPERM` —— 匿名管道被系统策略拒绝了。现在**完全绕开管道**：

```
子进程 stdout/stderr ──直接写──▶ %TEMP%/mdw-hexo-build-<pid>.log
                                      │  服务端按字节偏移增量读
                                      ▼
                              GET /api/build/log?from=N
```

`stdio: ['ignore', fd, fd]`，子进程持文件句柄自己写；服务端用字节偏移 + `StringDecoder` 增量读，实时滚动、断线重连不重复、中文不会切坏。

---

## HTTP 接口

想自己扩展（比如接 Typora、写脚本批量发文章）可以直接用：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ping` | 服务状态、博客目录、图床地址、认证码是否配好 |
| GET | `/api/config` | 前端用的配置 |
| GET | `/api/posts` | 文章列表 |
| GET | `/api/post?name=xxx.md` | 读一篇文章 |
| POST | `/api/post` | `{ name, content, overwrite }` 写一篇文章 |
| POST | `/api/upload` | 体是原始二进制；`X-Filename`（URL 编码）、`X-File-Type`、`X-Auth-Code`、`X-Imgbed-Base` |
| POST | `/api/build?mode=deploy\|preview\|clean` | 执行 hexo |
| GET | `/api/build/log?from=N` | 增量取构建日志 |
| GET | `/api/reload` | 重读 `config.json` / `config.local.json` |

不走界面直接传图：

```bash
curl -X POST http://127.0.0.1:8787/api/upload \
  -H "X-Filename: a.png" -H "X-File-Type: image/png" \
  -H "X-Imgbed-Base: https://img.yourdomain.com" \
  -H "X-Auth-Code: my-secret-code" \
  --data-binary "@a.png"
```

---

## 数据安全

- 只读写 `postsDir` 下的 `.md`，文件名做了路径穿越校验
- front-matter 里**不认识的字段原样保留**（`updated`、`permalink`、`cover`、`toc`…不会被吃掉）
- 日期没改动就沿用原文件的写法（含时分秒，避免 Hexo 排序被打乱）
- 保存前想确认，`git diff` 一眼就够

已知的轻微规范化：原文件里**空值**的 key（例如光秃秃一行 `tags:`）保存时会被省略，对 Hexo 行为没有影响。

---

## 目录结构

```
md-writer/
├─ server.js                本地服务：静态页 + 图床代理 + 读写 _posts + 调 hexo
├─ config.json              默认配置（可提交）
├─ config.local.json        本地覆盖：图床地址、认证码（已 gitignore）
├─ config.local.example.json 上面那个的模板
├─ 启动写作台.bat            Windows 双击启动
├─ start.sh                 macOS / Linux 启动
├─ public/
│  ├─ index.html            界面
│  ├─ style.css             样式（明/暗两套 CSS 变量）
│  ├─ app.js                全部前端逻辑
│  └─ vendor/marked.umd.js  markdown 渲染器（已内置，离线可用）
└─ test/
   ├─ fm-roundtrip.js       front-matter 往返自测
   └─ dom-smoke.js          无浏览器 DOM 冒烟测试
```

---

## 常见问题

**「没找到博客目录，无法读写文章」**
工具所在位置离博客根目录太远。用 `--blog` 指一下：

```bash
node server.js --blog "D:\my-blog"
```

**发布报「'hexo' 不是内部或外部命令」**
`hexo` 不在 PATH：`npm i -g hexo-cli`，然后**重开**一个新的终端窗口。

**发布日志只有一行 `启动失败：spawn EPERM`**
说明跑的是旧版本。当前版本不再用管道取输出，重启服务即可。

**上传转圈很久后失败**
图床在 Cloudflare 上，跨境访问偶尔慢，服务端超时 90 秒。先试试图床网页版能不能传。

**端口打不开 / 白屏**
看控制台打印的实际端口；确认没有另一个 `node server.js` 还在跑。

**预览和线上效果有差别**
预览只把 Markdown 转成 HTML，不加载主题 CSS 和插件。字体宽度、代码高亮不一致属正常。

**能在手机上用吗**
这是个只绑 `127.0.0.1` 的本地服务，没做鉴权，**不建议**暴露到公网。要在内网用可以改 `host` 为局域网 IP，但请自己加一层反向代理和密码。

---

## 自测

```bash
npm test
# 等价于
node test/fm-roundtrip.js     # 对文章目录每篇做「打开 → 重建」往返，校验正文与字段
node test/dom-smoke.js        # 最小 DOM 里跑完 init()，抓选择器拼错、初始化异常
```

`fm-roundtrip.js` 会自动向上寻找 `source/_posts`，也可以用参数指定：

```bash
node test/fm-roundtrip.js "D:\my-blog\source\_posts"
```

`dom-smoke.js` 需要服务已启动（默认 `http://127.0.0.1:8787`，可用环境变量 `MDW_BASE` 改）。

---

## 致谢

- [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) — 本项目对接的上传接口
- [marked](https://github.com/markedjs/marked) — Markdown 渲染
- [Hexo](https://hexo.io/) — 静态博客框架

## License

[MIT](LICENSE)
