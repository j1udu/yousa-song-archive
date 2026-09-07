# 泠鸢yousa 歌曲资料库

这是一个部署在 GitHub Pages 上的非官方歌曲资料索引站。网站只展示作品资料、版本资料、完整歌词和外部链接，不提供站内播放器。

## 添加歌曲

每个作品使用 `public/content/works/{work-id}/` 独立目录。目录中放置一个 `work.json`、若干 `version-{version-id}.json`，以及可选的封面和 `lyrics.txt`。标签统一维护在 `public/content/tags.json`。字段、继承和链接格式请看 [静态内容接口文档](./docs/content-api.md)。

```bash
npm install
npm run validate:content
npm run generate-content
npm run build
```

`npm run generate-content` 会扫描作品目录并生成 `public/content/works-index.json`。该文件是构建产物，不要手工编辑。

## 前端结构

前端不依赖框架，只使用 Vite + TypeScript，数据全部来自 `src/content/api.ts` 定义的静态内容接口。

| 文件 | 职责 |
| --- | --- |
| `src/main.ts` | 入口：路由分发、视图切换、封面加载失败回退 |
| `src/router.ts` | 路由约定：首页查询参数保存在 `?q=&year=&tag=&sort=&page=`，详情使用 `#/work/{id}` |
| `src/catalog/query.ts` | 首页纯逻辑：查询参数解析/序列化、搜索（标题、别名、作品与版本人员、版本名称）、标签（组内 OR、组间 AND）、排序、分页、卡片版本选取 |
| `src/catalog/view.ts` | 首页视图：只挂载一次，状态变化时局部更新，搜索输入不失焦、兼容中文输入法 |
| `src/work/view.ts` | 作品详情：人员资料 → 版本列表（严格按 `versionOrder`）→ 完整歌词（原生 `<details>` 折叠、纯文本） |
| `src/content/store.ts` | 索引/标签/作品/版本/歌词的内存缓存，失败后允许重试；版本层人员在用户聚焦搜索框或输入搜索词时按需并发读取全部版本文件（索引不含人员，且不为界面改索引字段） |
| `src/ui/` | 模板转义工具、内联的 Lucide 图标、页头页脚等公共片段 |
| `src/styles.css` | 全部样式，只使用系统字体，支持减少动态效果 |

## 测试与界面验证

正式内容目录为空是正常状态。界面测试使用独立夹具，不会写入 `public/content`。

```bash
npm test                 # 纯逻辑单元测试（node:test）
npm run fixtures:make    # 生成测试夹具到 fixtures/public/content 并构建夹具索引
npm run dev:fixtures     # 用夹具内容启动开发服务器
npm run build:fixtures   # 以 /yousa-song-archive/ 子路径构建夹具站到 dist-fixtures
npm run preview:fixtures # 预览夹具站：http://localhost:4174/yousa-song-archive/
```

浏览器验证脚本位于 `qa/`，使用独立的 `qa/package.json`（playwright-core 驱动本机 Google Chrome），不会给站点本身增加依赖。详见 [qa/README.md](./qa/README.md)。

## GitHub Pages

GitHub Actions 会在构建前自动扫描内容并生成索引，再从 `GITHUB_REPOSITORY` 推导项目站点子路径。自定义域名部署时，请将构建环境的 `VITE_BASE_PATH` 设置为 `/`。详情页使用 hash 路由，刷新不会触发 404。

## 本地曲库管理工具

管理工具只监听 `127.0.0.1`，不会被构建到公开站点，也不会自动提交或推送 Git。它会在临时副本中校验后才替换作品目录，并使用版本指纹避免旧页面覆盖外部修改。

```bash
npm run admin
# 浏览器打开终端显示的本地地址，通常是 http://127.0.0.1:4317
```

在管理页面中可以新建或编辑作品、版本、人员、标签选择、链接、歌词和封面。标签分组和标签定义仍手工维护 `public/content/tags.json`。保存后请点击“校验曲库”，再查看 `git diff`，确认无误后手动提交并推送。管理工具不会直接修改 `works-index.json`；公开站点构建时会重新生成它。

封面通过文件选择器复制到作品目录，支持 PNG/JPEG/WebP，单文件不超过 8 MB；歌词复制为 `lyrics.txt`，须为 UTF-8 且不超过 2 MB。
