/**
 * 生成独立的界面测试夹具（不写入正式内容目录 public/content）。
 * 输出：fixtures/public/content/{tags.json, works/*}
 * 之后运行 `tsx scripts/generate-content.ts fixtures` 生成夹具索引。
 *
 * 所有作品、人员、链接均为明显的测试数据，不代表任何真实歌曲。
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const ROOT = new URL("../fixtures/public/content/", import.meta.url).pathname;
const WORKS = join(ROOT, "works");

rmSync(ROOT, { recursive: true, force: true });
mkdirSync(WORKS, { recursive: true });

/* ---------- 标签配置：数组顺序故意与 order 不一致，用于验证按 order 排序 ---------- */
const tags = {
  schemaVersion: 1,
  groups: [
    {
      id: "scene",
      name: "场合",
      order: 3,
      tags: [
        { id: "live", name: "现场", order: 2 },
        { id: "studio", name: "录音室", order: 1 },
        { id: "project", name: "企划", order: 3 },
      ],
    },
    {
      id: "form",
      name: "内容形态",
      order: 1,
      tags: [
        { id: "cover", name: "翻唱", order: 2 },
        { id: "original", name: "原创", order: 1 },
        { id: "arrange", name: "改编", order: 3 },
        { id: "collab", name: "合作", order: 4 },
      ],
    },
    {
      id: "lang",
      name: "语言",
      order: 2,
      tags: [
        { id: "zh", name: "中文", order: 1 },
        { id: "ja", name: "日语", order: 2 },
        { id: "en", name: "英语", order: 3 },
        { id: "long-tag", name: "这是一个非常长的测试标签名称用于检查换行", order: 4 },
      ],
    },
  ],
};
writeFileSync(join(ROOT, "tags.json"), `${JSON.stringify(tags, null, 2)}\n`);

/* ---------- PNG 生成（无外部依赖） ---------- */
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(width, height, pixel) {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = y * stride + 1 + x * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** 渐变底 + 中央圆 + 四角方块：裁切或留白时肉眼可辨。 */
function artwork(width, height, hue) {
  const [r0, g0, b0] = hsl(hue, 0.55, 0.62);
  const [r1, g1, b1] = hsl((hue + 40) % 360, 0.6, 0.35);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.3;
  const corner = Math.min(width, height) * 0.12;
  return png(width, height, (x, y) => {
    const t = (x + y) / (width + height);
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy < radius * radius) return [250, 250, 250];
    const inCorner = (x < corner || x >= width - corner) && (y < corner || y >= height - corner);
    if (inCorner) return [20, 30, 40];
    return [Math.round(r0 + (r1 - r0) * t), Math.round(g0 + (g1 - g0) * t), Math.round(b0 + (b1 - b0) * t)];
  });
}
function hsl(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/* ---------- 作品写入 ---------- */
function writeWork(work, versions, extras = {}) {
  const dir = join(WORKS, work.id);
  mkdirSync(dir, { recursive: true });
  const full = {
    schemaVersion: 1,
    id: work.id,
    title: work.title,
    aliases: work.aliases ?? [],
    year: work.year ?? null,
    tags: work.tags ?? [],
    people: work.people ?? {},
    cover: extras.cover ? extras.cover.name : null,
    lyrics: extras.lyrics !== undefined ? "lyrics.txt" : null,
    summary: work.summary ?? "",
    versionOrder: work.versionOrder ?? versions.map((version) => version.id),
    featuredVersions: work.featuredVersions ?? [],
  };
  writeFileSync(join(dir, "work.json"), `${JSON.stringify(full, null, 2)}\n`);
  for (const version of versions) {
    const record = {
      schemaVersion: 1,
      id: version.id,
      name: version.name,
      type: version.type,
      date: version.date ?? null,
      people: version.people ?? {},
      links: version.links ?? [],
      notes: version.notes ?? "",
      ...(version.audio ? { audio: version.audio, audioRights: version.audioRights ?? null } : {}),
    };
    writeFileSync(join(dir, `version-${version.id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  }
  if (extras.cover) writeFileSync(join(dir, extras.cover.name), extras.cover.data);
  if (extras.lyrics !== undefined) writeFileSync(join(dir, "lyrics.txt"), extras.lyrics);
  for (const file of extras.files ?? []) writeFileSync(join(dir, file.name), file.data);
}

const link = (platform, label, slug) => ({ platform, url: `https://example.com/fixture/${slug}`, label });

const LONG_LYRICS = [
  "第一段",
  "这是一行测试歌词 <b>尖括号不应被解析为 HTML</b>",
  "包含 &amp; 实体写法与   连续空格   的一行",
  "",
  "第二段（上面的空行需要保留）",
  "　全角空格开头的一行",
  "这一行非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长，用于检查自动换行是否正常。",
  "",
  "第三段",
  "末尾一行",
  "",
].join("\n");

/* 01：长标题 + 全部标签 + 5 个版本 + featured 为空（回退到 versionOrder 前 3 个） */
writeWork(
  {
    id: "fx-01-long-title",
    title: "长标题测试：这是一个用于验证卡片与详情页在遇到非常长的作品标题时仍然能够正常换行而不会横向溢出或与其他元素重叠的夹具作品",
    aliases: ["长标题别名一", "Long Title Alias", "超长别名超长别名超长别名超长别名超长别名超长别名"],
    year: 2024,
    tags: ["original", "cover", "arrange", "collab", "zh", "ja", "en", "long-tag", "studio", "live", "project"],
    people: {
      演唱: ["测试演唱者甲"],
      作词: ["测试作词者乙"],
      作曲: ["测试作曲者丙"],
      编曲: ["测试编曲者丁", "测试编曲者戊"],
      混音: ["测试混音师己"],
    },
    summary: "这是一段作品简介，用于测试详情页的简介区域。\n第二行简介用于检查换行是否保留。",
    // 故意不按日期排列：现场(2024) → 正式(2024-03-01) → 合作(2025-06-30) → 改编(无日期) → 不插电(2025-01-15)
    versionOrder: ["v-live", "v-studio", "v-collab", "v-remix", "v-acoustic"],
    featuredVersions: [],
  },
  [
    {
      id: "v-studio",
      name: "录音室正式版",
      type: "正式版",
      date: "2024-03-01",
      links: [link("示例平台A", "正式音源", "01-studio-a"), link("示例平台B", "官方公告", "01-studio-b")],
      notes: "第一行备注\n第二行备注",
      audio: [
        { quality: "FLAC 无损", url: "https://example.invalid/audio/audio-v-studio.flac", format: "flac", size: 1024 },
        { quality: "MP3 320k", file: "audio-v-studio.mp3", format: "mp3" },
      ],
      audioRights: "authorized",
    },
    { id: "v-live", name: "测试演唱会现场版", type: "现场", date: "2024", links: [link("示例平台A", "现场视频", "01-live")] },
    { id: "v-remix", name: "无链接改编版", type: "改编", date: null, links: [], notes: "这个版本没有任何链接，链接区域应完全隐藏。" },
    { id: "v-acoustic", name: "不插电版（人员替换）", type: "改编", date: "2025-01-15", people: { 演唱: ["测试演唱者甲", "测试演唱者庚"], 编曲: ["测试编曲者辛"] }, links: [link("示例平台C", "音频", "01-acoustic")] },
    { id: "v-collab", name: "合作版", type: "合作", date: "2025-06-30", people: { 演唱: ["测试演唱者甲", "测试演唱者壬"] }, links: [link("示例平台A", "合作视频", "01-collab")] },
  ],
  {
    cover: { name: "cover.png", data: artwork(400, 400, 196) },
    lyrics: LONG_LYRICS,
    files: [
      { name: "audio-v-studio.flac", data: Buffer.from("fixture flac download") },
      { name: "audio-v-studio.mp3", data: Buffer.from("fixture mp3 download") },
    ],
  },
);

/* 02：featuredVersions 指定 2 个（非首位、逆序），共 4 个版本 */
writeWork(
  {
    id: "fx-02-featured",
    title: "重点版本测试曲",
    aliases: ["Featured Fixture"],
    year: 2023,
    tags: ["cover", "ja"],
    people: { 演唱: ["测试演唱者甲"], 作曲: ["测试作曲者丙"] },
    summary: "featuredVersions 指定了 v-d 与 v-b，卡片应按此顺序只显示这两个版本。",
    versionOrder: ["v-a", "v-b", "v-c", "v-d"],
    featuredVersions: ["v-d", "v-b"],
  },
  [
    { id: "v-a", name: "版本 A", type: "正式版", date: "2023-01-01", links: [link("示例平台A", "音源", "02-a")] },
    { id: "v-b", name: "版本 B（重点）", type: "翻唱", date: "2023-02-02", links: [link("示例平台A", "音源", "02-b")] },
    { id: "v-c", name: "版本 C", type: "现场", date: "2023-03-03", links: [] },
    { id: "v-d", name: "版本 D（重点）", type: "改编", date: "2023-04-04", links: [link("示例平台B", "视频", "02-d")] },
  ],
  { cover: { name: "cover.png", data: artwork(400, 400, 24) }, lyrics: "只有一行歌词的作品\n" },
);

/* 03：最简作品：无年份、无封面、无歌词、无简介、无人员、无标签、1 个无链接版本 */
writeWork(
  {
    id: "fx-03-minimal",
    title: "最简作品",
    year: null,
    tags: [],
    people: {},
    summary: "",
    featuredVersions: [],
  },
  [{ id: "v-only", name: "唯一版本", type: "正式版", date: null, people: {}, links: [], notes: "" }],
);

/* 04：封面文件损坏（存在但不是有效图片）→ 应显示统一文字占位 */
writeWork(
  {
    id: "fx-04-broken-cover",
    title: "封面损坏测试曲",
    year: 2022,
    tags: ["original", "zh", "studio"],
    people: { 演唱: ["测试演唱者甲"] },
    summary: "cover.png 不是有效图片，卡片和详情页都应显示“暂无封面”占位。",
  },
  [
    { id: "v-1", name: "版本一", type: "正式版", date: "2022-05-05", links: [link("示例平台A", "音源", "04-1")] },
    { id: "v-2", name: "版本二", type: "现场", date: "2022-06-06", links: [] },
  ],
  { cover: { name: "cover.png", data: Buffer.from("this is not a png file") }, lyrics: "歌词\n" },
);

/* 05：宽幅封面 600×300 */
writeWork(
  { id: "fx-05-wide-cover", title: "宽幅封面测试曲", year: 2021, tags: ["arrange", "en", "live"], people: { 演唱: ["测试演唱者甲"], 作曲: ["测试作曲者丙"] }, summary: "封面是 600×300 的宽图。" },
  [{ id: "v-1", name: "宽幅版本", type: "改编", date: "2021-07-07", links: [link("示例平台A", "视频", "05")] }],
  { cover: { name: "cover.png", data: artwork(600, 300, 268) }, lyrics: LONG_LYRICS },
);

/* 06：竖幅封面 300×600 */
writeWork(
  { id: "fx-06-tall-cover", title: "竖幅封面测试曲", year: 2020, tags: ["collab", "zh", "project"], people: { 演唱: ["测试演唱者甲", "测试演唱者庚"] }, summary: "封面是 300×600 的竖图。" },
  [{ id: "v-1", name: "竖幅版本", type: "合作", date: "2020", links: [link("示例平台B", "企划页面", "06")] }],
  { cover: { name: "cover.png", data: artwork(300, 600, 152) } },
);

/* 07：人员继承：继承 / 替换 / 清除 / 新增角色；日期：仅年份 / 完整 / 未知 */
writeWork(
  {
    id: "fx-07-people",
    title: "人员继承测试曲",
    aliases: ["People Inheritance"],
    year: 2019,
    tags: ["original", "zh"],
    people: { 演唱: ["测试演唱者甲"], 作词: ["测试作词者乙"], 作曲: ["测试作曲者丙"], 编曲: ["测试编曲者丁"] },
    summary: "v-base 完全继承；v-replace 替换演唱；v-clear 清除编曲并新增和声。",
    versionOrder: ["v-base", "v-replace", "v-clear"],
    featuredVersions: ["v-clear"],
  },
  [
    { id: "v-base", name: "继承版（仅年份日期）", type: "正式版", date: "2019", people: {}, links: [link("示例平台A", "音源", "07-base")] },
    { id: "v-replace", name: "替换演唱版", type: "翻唱", date: "2019-08-08", people: { 演唱: ["测试演唱者庚", "测试演唱者辛"] }, links: [link("示例平台A", "音源", "07-replace")] },
    { id: "v-clear", name: "清除编曲并新增和声版（无日期）", type: "现场", date: null, people: { 编曲: [], 和声: ["测试和声者壬"] }, links: [] },
  ],
  { cover: { name: "cover.png", data: artwork(400, 400, 336) }, lyrics: "第一行\r\n第二行（CRLF 换行）\r\n\r\n第四行\r\n" },
);

/* 08：没有任何版本 */
writeWork({ id: "fx-08-no-versions", title: "无版本作品", year: 2018, tags: ["original"], people: { 作曲: ["测试作曲者丙"] }, summary: "该作品还没有版本资料。", versionOrder: [] }, [], { cover: { name: "cover.png", data: artwork(64, 64, 44) } });

/* 09：一个版本多个链接（含长标签） */
writeWork(
  { id: "fx-09-many-links", title: "多链接测试曲", year: 2017, tags: ["cover", "ja", "studio"], people: { 演唱: ["测试演唱者甲"] }, summary: "单个版本包含三条链接。" },
  [
    {
      id: "v-1",
      name: "多链接版本",
      type: "正式版",
      date: "2017-09-09",
      links: [
        link("示例平台A", "正式音源", "09-a"),
        link("示例平台B", "这是一个非常长的链接说明文字用于测试链接标签在窄屏幕上的换行效果是否正常且不会溢出", "09-b"),
        link("示例平台C", "官方公告", "09-c"),
      ],
      notes: "三条链接必须按数组顺序展示。",
    },
  ],
  { lyrics: LONG_LYRICS },
);

/* 10：搜索测试：独特的版本名 / 人员 / 别名 */
writeWork(
  {
    id: "fx-10-search",
    title: "搜索测试曲",
    aliases: ["SearchAliasUnique", "全角ＡＢＣ别名"],
    year: 2016,
    tags: ["arrange", "en", "live"],
    people: { 作曲: ["独特作曲者癸"], 演唱: ["测试演唱者甲"] },
    summary: "用于验证按标题、别名、人员和版本名称搜索。",
  },
  [
    { id: "v-1", name: "星海测试演唱会现场", type: "现场", date: "2016-10-10", links: [link("示例平台A", "现场视频", "10-1")] },
    { id: "v-2", name: "普通版本", type: "正式版", date: "2016-11-11", links: [] },
  ],
  { cover: { name: "cover.png", data: artwork(400, 400, 80) }, lyrics: "搜索测试曲歌词\n" },
);

/* 11 / 12：拉丁字母标题，用于标题排序 */
writeWork({ id: "fx-11-alpha", title: "Alpha Latin Title", year: 2026, tags: ["original", "en"], people: { 演唱: ["测试演唱者甲"] }, summary: "英文标题，年份最新。" }, [{ id: "v-1", name: "Studio Take", type: "正式版", date: "2026-01-01", links: [link("示例平台A", "Audio", "11")] }], { lyrics: "Alpha lyrics line\n" });
writeWork({ id: "fx-12-zeta", title: "Zeta Latin Title", year: 2015, tags: ["cover", "en"], people: { 演唱: ["测试演唱者甲"] }, summary: "英文标题，年份最早。" }, [{ id: "v-1", name: "Live Take", type: "现场", date: "2015-12-12", links: [] }]);

/* 13–30：填充作品，保证 3 页分页、年份和标签分布 */
const FILL_TITLES = ["十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "二十一", "二十二", "二十三", "二十四", "二十五", "二十六", "二十七", "二十八", "二十九", "三十"];
const FORM = ["original", "cover", "arrange", "collab"];
const LANG = ["zh", "ja", "en"];
const SCENE = ["studio", "live", "project"];
const YEARS = [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018];
FILL_TITLES.forEach((label, index) => {
  const number = 13 + index;
  const year = number === 14 ? null : YEARS[index % YEARS.length];
  const tagSet = number % 5 === 0 ? [] : [FORM[index % FORM.length], LANG[index % LANG.length], ...(index % 2 ? [SCENE[index % SCENE.length]] : [])];
  const versionCount = 1 + (index % 3);
  const versions = Array.from({ length: versionCount }, (_, versionIndex) => ({
    id: `v-${versionIndex + 1}`,
    name: `夹具作品${label} 版本 ${versionIndex + 1}`,
    type: ["正式版", "现场", "翻唱"][versionIndex % 3],
    date: year ? `${year}-0${(versionIndex % 9) + 1}-1${versionIndex}` : null,
    links: versionIndex % 2 === 0 ? [link("示例平台A", "音源", `${number}-${versionIndex}`)] : [],
  }));
  writeWork(
    {
      id: `fx-${number}-fill`,
      title: `夹具作品${label}`,
      aliases: index % 4 === 0 ? [`Fill Alias ${number}`] : [],
      year,
      tags: tagSet,
      people: { 演唱: ["测试演唱者甲"], 作曲: [index % 2 ? "测试作曲者丙" : "测试作曲者子"] },
      summary: index % 3 === 0 ? `夹具作品${label}的简介。` : "",
    },
    versions,
    index % 3 === 0 ? { cover: { name: "cover.png", data: artwork(400, 400, (index * 37) % 360) }, lyrics: `夹具作品${label}的歌词\n第二行\n` } : {},
  );
});

console.log(`夹具已生成：${ROOT}`);
