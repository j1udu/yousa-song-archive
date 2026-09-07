# 界面验证

本目录与站点本身的依赖隔离：`qa/package.json` 只包含 `playwright-core`，通过 `channel: "chrome"` 驱动本机已安装的 Google Chrome，不下载浏览器。

## 文件

| 文件 | 用途 |
| --- | --- |
| `make-fixtures.mjs` | 生成独立测试夹具到 `fixtures/public/content`（30 个作品、3 组标签、损坏封面、宽/竖封面、人员继承、无链接版本、零版本作品等） |
| `browser-check.mjs` | 端到端检查：搜索、输入法合成、组合筛选、排序、分页、URL 恢复、详情契约、错误状态与重试、键盘焦点、减少动态效果、手机/平板/桌面布局；截图保存到 `screenshots/` |
| `viewport-shot.mjs` | 按指定视口截取首屏截图（调试用） |
| `diag-overflow.mjs` | 列出 390px 视口下超出窗口的元素（调试用） |
| `screenshots/` | 最近一次运行留存的截图与 `*-report.md` 报告 |

## 运行

```bash
# 站点根目录
npm run fixtures:make
npm run build:fixtures
npm run preview:fixtures        # 终端 A：http://localhost:4174/yousa-song-archive/

# 另开终端
cd qa && npm install
QA_BASE=http://localhost:4174/yousa-song-archive/ QA_MODE=fixtures node browser-check.mjs

# 正式（当前为空）内容
npm run build && npx vite preview --port 4175    # 终端 B
QA_BASE=http://localhost:4175/ QA_MODE=empty node browser-check.mjs
```

脚本会把页面结果与索引 JSON 独立计算出的预期结果对照，并断言所有内容请求都落在站点子路径之下。
