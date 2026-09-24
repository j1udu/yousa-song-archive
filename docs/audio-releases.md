# 授权音频发布

网站只保存下载链接，不托管音频文件，也不会在打开页面时预取音频。音频作为本仓库的公开 GitHub Release 附件发布：`audio-flac-v1` 和 `audio-mp3-v1`。每个附件以 `{workId}-{versionId}.{format}` 命名，网页通过对应版本 JSON 中的 `audio[].url` 下载。

## 新增或更新

1. 先在审查清单中确认歌曲和版本，并更新 `outputs/song-metadata/netease-source-map.json` 及版本文件。
2. 在仓库根目录的 `.env.local` 设置 `NETEASE_MUSIC_U`，不要提交、打印或分享该文件。
3. 执行 `npm run audio:download`。音频放在 Git 忽略的 `.audio-cache/`，清单 `.audio-cache/manifest.json` 保存文件大小和 SHA-256。再次执行会复用已有文件并补齐失败项；报告中 `errors` 必须为 0。
4. 确认 GitHub CLI 有仓库写入权限、仓库为公开状态，然后执行 `npm run audio:publish`。脚本先校验本地文件大小和 SHA-256，跳过哈希一致的远端附件，上传缺失或替换的音频并复核 GitHub 返回的摘要，再把链接写入版本 JSON 和 `outputs/song-metadata/github-audio-assets.json`。中断后可以重复执行。
5. 执行 `npm run validate:content && npm test && npm run build`，检查变更后提交、推送。GitHub Pages 的构建不包含 `.audio-cache/`。

已上传的附件如果需要替换，必须先确保本地清单重新计算了新音频的大小与 SHA-256。`audioRights: "authorized"` 只用于确认本站可以分发该版本；无可用音频的版本不会出现下载按钮。

Release 是公开附件，任何人只要知道链接即可下载。不要在版本 JSON、报告、Release 描述或 Git 历史中写入网易云 Cookie 或临时音频地址。
