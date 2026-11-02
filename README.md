# 写作台 · Markdown + 自建图床

一个跑在本机的 Markdown 写稿工具，给写 Hexo 博客的人用。**粘贴或拖入图片 → 自动上传到你的图床 → 链接直接落回光标处**，写完点一下就能生成并发布。

```
剪贴板截图 / 拖进来的图片
        │
        ▼
  本机上跑的小服务  ──POST──▶  你自己的图床（CloudFlare-ImgBed）
        │                        │
        └────  ![名字](链接)  ◀───┘   直接插进正文
```

适合谁：用 Hexo（或任何「`source/_posts` 下一堆 .md」的博客）、想给文章配图、又不想手动开图床网页上传再复制链接的人。

- **零依赖**：只要 Node.js 18+，不用 `npm install`，不连任何 CDN，断网也能写
- **图片不落地**：截图直接进图床，博客仓库里不会多出一堆 `images/` 文件夹
- **图床是你自己的**：地址和认证码填在你自己机器上，代码里是空的，谁 clone 都不会带着别人的图床
- **配置一次就够**：填完保存进本机 `config.local.json`，下次启动、换端口、换浏览器都不用再填

目录：

- [功能](#功能) · [快速开始](#快速开始) · [接入你自己的图床](#接入你自己的图床) · [文章属性](#文章属性front-matter) · [配置项](#配置项) · [常见问题](#常见问题)

---

## 功能

| 功能 | 说明 |
| --- | --- |
| 文章列表 | 列出 `source/_posts/*.md`，标题取 front-matter，按修改时间排序，支持搜索 |
| 新建 / 打开 / 保存 | 保存即写回 `source/_posts/文件名.md`，Ctrl+S 随手存 |
| 实时预览 | marked 渲染，参数按 `hexo-renderer-marked` 默认值（`gfm`/`breaks`/`headerIds`/`mangle`）设置，预览≈站点实际效果 |
| 贴图上传 | 三种方式：Ctrl+V 粘贴截图、把图片拖进编辑区、点工具栏「插入图片」 |
| 插入格式 | `![alt](url)` / `<img src>` / 纯链接，设置里可切换；可勾选「上传后自动复制链接」 |
| 工具栏 | H1–H3、粗体/斜体/删除线、引用、有序无序列表、行内代码、代码块、链接、表格、分割线、`<!-- more -->` |
| 文章属性 | meta 栏下面的「文章属性」折叠面板，26 个 front-matter 字段图形化填写：封面图 / 顶部图可直接上传 + 一键互转，摘要一键从正文生成，页面开关（评论、目录、版权、MathJax…）、首页轮播与推荐序号 |
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

3. 浏览器会打开 `http://127.0.0.1:8787/`。**第一次**进去点右上角 ⚙️ **设置**，填图床地址和认证码 → 保存。之后就再也不用了（见下一节）

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

### 3. 填进写作台（只填一次）

右上角 ⚙️ 设置 → 图床地址 / 上传认证码 → **保存**。

保存会同时做两件事，所以「配置一次」是字面意思：

| 存到哪 | 作用 |
| --- | --- |
| 浏览器 localStorage | 当前这个页面立刻生效 |
| 本机 `config.local.json` | 下次启动自动读取——换端口（8788/8789…）、换浏览器、清掉站点数据都不影响 |

`config.local.json` 是在你第一次保存时自动生成的，**已在 `.gitignore` 里，不会被提交**。也可以在启动前自己写（适合固定环境、或者你想让 `curl` 直接调接口）：

```bash
cp config.local.example.json config.local.json
```

```json
{
  "imgbedBase": "https://img.yourdomain.com",
  "authCode": "my-secret-code"
}
```

优先级：**界面设置 > `config.local.json` > `config.json`**。手改配置文件后需重启服务（或访问 `http://127.0.0.1:8787/api/reload`）；从界面保存则立即生效、无需重启。

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

> 在界面「设置」里保存时，只会把这几个跟图床有关的键（`imgbedBase`、`authCode`、`imageInsertFormat`）写进 `config.local.json`，其他键原样保留。这个文件必须是**合法 JSON**（不能写 `//` 注释）；万一格式坏了，保存会直接报错、不会把你的配置覆盖掉。

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

## 文章属性（front-matter）

meta 栏下面的 **文章属性** 按钮展开一块面板，覆盖 [AnZhiYu 主题文档](https://blog-anzhiyu.pages.dev/anzhiyu-docs/page-configuration.html) 里 Post Front-matter 的全部字段。不用背字段名，填表就行；留空的字段不会写进文件，等于用主题默认值。

> 这套字段是按 AnZhiYu 整理的，换成别的 Hexo 主题也能用——不认识的字段主题会忽略，只是不起作用而已。想加自己主题的字段，改 `public/app.js` 顶部的 `FIELDS` 表即可（一条记录 = 一个字段名 + 类型）。

| 字段 | 作用 |
| --- | --- |
| `title` / `date` | 标题、发布日期（改了日期会保留原来的时分秒） |
| `tags` / `categories` | 标签、分类，逗号分隔；写回时变成 `["a", "b"]` |
| `updated` | 最后更新日期，不填主题就用页面构建时间 |
| `keywords` | SEO 关键词 |
| `description` | 摘要，首页卡片和 meta description 用它；面板里有「从正文生成」 |
| `cover` | 首页卡片缩略图。也可填 `false` 强制不显示 |
| `top_img` | 文章页顶部大图。也可填 `false` 关掉 |
| `comments` / `toc` / `toc_number` / `toc_style_simple` | 评论、目录、目录编号、简洁目录 |
| `copyright` 及 `copyright_author` / `_href` / `copyright_url` / `copyright_info` | 版权模块开关与作者、原文链接、声明 |
| `aside` | 侧边栏 |
| `mathjax` / `katex` | 公式渲染，二选一 |
| `highlight_shrink` | 代码块默认折叠 |
| `aplayer` | 音乐播放器 |
| `swiper_index` | 首页轮播序号，数字越小越靠前 |
| `top_group_index` | 首页推荐卡片组序号 |
| `background` | 文章页背景色，如 `#eef2f6` |

「页面开关」那几项是三态的：**默认**（不写字段，跟主题配置走）、**开**、**关**。

封面图和顶部图都有「上传」按钮，选完图片直接传图床、把链接填进对应字段，下面还会显示缩略图预览；「→顶部 / →封面」可以把一个地址复制给另一个。

保存时字段顺序保持你原文件的样子，新增的字段按上表顺序追加。面板里没覆盖的字段（比如 `permalink`、`aplayer` 之外的插件字段）**不会被吃掉**，会原样留在 front-matter 里。

> 兼容性：有些编辑器保存时会加 UTF-8 BOM，或者丢了开头那行 `---`。写作台对这两种情况都能正确读出 front-matter，保存时顺手写成标准格式。

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
| GET | `/api/config` | 前端用的配置（含本机已保存的图床地址与认证码） |
| POST | `/api/config` | `{ imgbedBase, authCode, imageInsertFormat }` 写进 `config.local.json`，立刻生效 |
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

关于认证码：它存在本机 `config.local.json` 里（明文），该文件已被 `.gitignore` 忽略；服务只监听 `127.0.0.1`。**不要**把 `config.local.json` 提交到公开仓库，也不要把服务开到公网。

已知的轻微规范化：原文件里**空值**的 key（例如光秃秃一行 `tags:`）保存时会被省略，对 Hexo 行为没有影响。

---

## 目录结构

```
md-writer/
├─ server.js                本地服务：静态页 + 图床代理 + 读写 _posts + 调 hexo
├─ config.json              默认配置（可提交）
├─ config.local.json        你保存设置后自动生成：图床地址、认证码（已 gitignore）
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

**换了个端口，设置还在吗**
在。图床地址、认证码、插入格式都存在 `config.local.json`，跟着机器走，与浏览器、端口都无关。只有「自动复制链接 / 自动保存草稿」这两个开关存在浏览器里。

**想把配置发给别人 / 提交到公开仓库**
只发代码，别发 `config.local.json`（它已经在 `.gitignore` 里）。对方的图床应该由对方自己填一次。

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

`dom-smoke.js` 需要服务已启动（默认 `http://127.0.0.1:8787`，可用环境变量 `MDW_BASE` 改）。如果服务端已经保存过图床配置，它还会顺带验证「配置一次」这条路径：`config.local.json` 里的值应当自动接管到界面设置里。

---

## 致谢

- [CloudFlare-ImgBed](https://github.com/MarSeventh/CloudFlare-ImgBed) — 本项目对接的上传接口
- [marked](https://github.com/markedjs/marked) — Markdown 渲染
- [Hexo](https://hexo.io/) — 静态博客框架

## License

[MIT](LICENSE)

最终效果如下：<img width="1920" height="1030" alt="ScreenShot_2026-11-03_062758_784" src="https://github.com/user-attachments/assets/42f31a27-865a-43c9-8c88-bc831b9f8303" />
<img width="795" height="610" alt="ScreenShot_2026-11-03_071342_698" src="https://github.com/user-attachments/assets/22f7a6d6-c250-40fd-906d-d1b1d2accaf8" />
<img width="1910" height="925" alt="ScreenShot_2026-11-03_070839_654" src="https://github.com/user-attachments/assets/b455391c-1dab-4cdd-8a46-5e2d811cf52b" />
<img width="1223" height="639" alt="ScreenShot_2026-11-03_062820_455" src="https://github.com/user-attachments/assets/e23575ce-caed-448d-b1c2-07f7e00d8abd" />


