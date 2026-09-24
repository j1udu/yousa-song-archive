# 静态内容接口

本项目没有运行时后端。GitHub Pages 发布的是只读静态资源，下面的路径构成前端使用的内容接口。所有路径都相对于站点的 `BASE_URL`，前端不得把域名写死。

## 资源总览

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/content/works-index.json` | 构建时生成的作品索引，首页分页使用 |
| `GET` | `/content/tags.json` | 标签分组和标签词表 |
| `GET` | `/content/works/{work-id}/work.json` | 单个作品的完整元数据 |
| `GET` | `/content/works/{work-id}/version-{version-id}.json` | 单个版本的完整资料 |
| `GET` | `/content/works/{work-id}/{lyrics-file}` | 作品层完整歌词（可选资源，文件名由 `work.json` 指定） |
| `GET` | `/content/works/{work-id}/{cover-file}` | 作品封面（可选资源） |
| `GET` | `/content/works/{work-id}/{audio-file}` | 版本授权音频（下载资源） |

接口是公开、只读、无认证的静态文件。未知路径由 GitHub Pages 返回 `404`；构建阶段会先检查仓库内的路径和字段。

前端对应的 TypeScript 读取函数位于 `src/content/api.ts`：

| 函数 | 读取资源 |
| --- | --- |
| `loadWorkIndex()` | `/content/works-index.json` |
| `loadTagCatalog()` | `/content/tags.json` |
| `loadWork(workId)` | `/content/works/{work-id}/work.json` |
| `loadVersion(workId, versionId)` | `/content/works/{work-id}/version-{version-id}.json` |
| `loadLyrics(path)` | `work.json` 中指定的歌词文件 |

这些函数会自动使用 `import.meta.env.BASE_URL`，可直接用于 GitHub Pages 项目子路径部署。

## 标签目录

`/content/tags.json`：

```json
{
  "schemaVersion": 1,
  "groups": [
    {
      "id": "form",
      "name": "内容形态",
      "order": 1,
      "tags": [
        { "id": "original", "name": "原创", "order": 1 }
      ]
    }
  ]
}
```

标签 ID 在整个目录中全局唯一。作品只保存标签 ID，不重复保存标签名称。

筛选规则：同一分组内多个标签为 OR，不同分组之间为 AND。

## 作品元数据

路径：`/content/works/{work-id}/work.json`

```json
{
  "schemaVersion": 1,
  "id": "example-work",
  "title": "作品标题",
  "aliases": [],
  "year": 2024,
  "tags": ["original"],
  "people": {
    "作词": ["姓名"],
    "作曲": ["姓名"]
  },
  "cover": "cover.webp",
  "lyrics": "lyrics.txt",
  "summary": "作品简介。",
  "versionOrder": ["official", "live"],
  "featuredVersions": ["official"]
}
```

字段约定：

- `id` 必须和作品目录名一致，只能使用小写英文、数字和连字符。
- `year` 是作品最早公开版本的年份；未知时为 `null`。
- `people` 是作品层默认角色映射。
- `cover` 和 `lyrics` 是相对于作品目录的文件名；没有资源时为 `null`。
- `versionOrder` 是唯一的版本展示顺序，必须列出目录内全部版本 ID，页面不自动按日期排序。
- `featuredVersions` 最多 3 个；为空时前端取 `versionOrder` 的前 3 个。

## 版本资料

路径：`/content/works/{work-id}/version-{version-id}.json`

```json
{
  "schemaVersion": 1,
  "id": "official",
  "name": "正式发布版",
  "type": "正式版",
  "date": "2024-05-01",
  "people": {
    "演唱": ["泠鸢yousa"]
  },
  "links": [
    {
      "platform": "Bilibili",
      "url": "https://www.bilibili.com/",
      "label": "正式音源"
    }
  ],
  "audio": [
    { "quality": "FLAC 无损", "url": "https://github.com/example/archive/releases/download/audio-flac-v1/example-v01.flac", "format": "flac" },
    { "quality": "MP3 320k", "file": "audio-official-320.mp3", "format": "mp3" }
  ],
  "audioRights": "authorized",
  "notes": "版本备注。"
}
```

字段约定：

- `id` 必须与文件名中的 `{version-id}` 一致。
- `date` 使用 `YYYY-MM-DD` 或 `YYYY`；未知时为 `null`。
- `people` 只写相对作品默认人员发生变化的角色；省略角色表示继承，空数组表示明确清除该角色。
- `links` 可以为空。为空时版本仍展示，但前端完全隐藏链接区域。
- `audio` 是可选的音频下载条目数组；每项包含音质名称、`mp3`/`flac` 格式，以及作品目录内 `file` 或 HTTPS `url`。远程音频可附带 `size` 和 `sha256` 用于核验。旧版本缺少该字段时按空数组处理。
- `audioRights` 收录音频时必须为 `authorized`，否则内容校验失败；详情页只为已授权音频显示“下载”按钮。
- GitHub Release 音频的上传与更新步骤见 [授权音频发布](./audio-releases.md)。
- 每条链接必须有 `platform`、`url`、`label`，URL 只接受 `http` 或 `https`。

## 构建索引

构建脚本扫描 `public/content/works/*/`，读取并校验所有作品和版本文件，生成 `public/content/works-index.json`。该文件是生成产物，不应手工编辑，也不构成第二份作品数据源。索引包含首页分页所需的完整作品摘要，版本只保留卡片需要的摘要字段；打开详情时再读取对应的 `work.json` 和版本 JSON。

索引使用稳定字段：

```json
{
  "schemaVersion": 1,
  "works": [
    {
      "id": "example-work",
      "title": "作品标题",
      "aliases": [],
      "year": 2024,
      "tags": ["original"],
      "people": { "作曲": ["姓名"] },
      "cover": "cover.webp",
      "lyrics": "lyrics.txt",
      "summary": "作品简介。",
      "versionOrder": ["official"],
      "featuredVersions": ["official"],
      "path": "content/works/example-work/work.json",
      "coverUrl": "content/works/example-work/cover.webp",
      "lyricsUrl": "content/works/example-work/lyrics.txt",
      "versions": [
        {
          "id": "official",
          "name": "正式发布版",
          "type": "正式版",
          "date": "2024-05-01",
          "path": "content/works/example-work/version-official.json"
        }
      ]
    }
  ]
}
```

## 查询参数约定

首页使用 URL 查询参数保存查询状态：

```text
/?q=关键词&tag=标签ID&year=2024&page=2
```

筛选变化时页码重置为 `1`。每页 12 个作品。首页结果粒度始终是作品，版本不会单独占用分页位置。
