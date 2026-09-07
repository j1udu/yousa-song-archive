import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { contentPaths } from "../scripts/content-lib";
import { AdminError, readEditorWork, saveEditorWork, validateEditor } from "../scripts/admin-content";
import type { Version, Work } from "../src/content/types";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "yousa-admin-test-"));
  const paths = contentPaths(root); mkdirSync(paths.works, { recursive: true });
  writeFileSync(paths.tags, JSON.stringify({ schemaVersion: 1, groups: [] }));
  return root;
}
function payload(id = "test-work") {
  const work: Work = { schemaVersion: 1, id, title: "测试作品", aliases: [], year: 2024, tags: [], people: { 演唱: ["甲"] }, cover: null, lyrics: null, summary: "", versionOrder: ["official", "live"], featuredVersions: ["official"] };
  const versions: Version[] = [
    { schemaVersion: 1, id: "official", name: "正式版", type: "正式版", date: "2024", people: {}, links: [], notes: "" },
    { schemaVersion: 1, id: "live", name: "现场版", type: "现场", date: null, people: { 演唱: ["乙"], 和声: ["丙"] }, links: [], notes: "" },
  ];
  return { work, versions };
}

test("管理工具在临时副本校验后创建作品，并保留版本顺序和资源", () => {
  const root = fixture();
  try {
    const result = saveEditorWork(root, { ...payload(), coverAsset: { name: "source.png", contentBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") }, lyricsAsset: { name: "source.txt", contentBase64: Buffer.from("歌词\n").toString("base64") } });
    assert.equal(result.work.cover, "cover.png"); assert.equal(result.work.lyrics, "lyrics.txt");
    assert.deepEqual(result.work.versionOrder, ["official", "live"]);
    assert.equal(readFileSync(join(contentPaths(root).works, "test-work", "lyrics.txt"), "utf8"), "歌词\n");
    assert.equal(validateEditor(root).works, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("编辑使用版本指纹，过期页面不能覆盖外部修改", () => {
  const root = fixture();
  try {
    saveEditorWork(root, payload()); const opened = readEditorWork(root, "test-work");
    writeFileSync(join(contentPaths(root).works, "test-work", "work.json"), JSON.stringify({ ...opened.work, title: "外部修改" }));
    assert.throws(() => saveEditorWork(root, { ...payload(), revision: opened.revision }, "test-work"), (error) => error instanceof AdminError && error.status === 409);
    assert.equal(readEditorWork(root, "test-work").work.title, "外部修改");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("编辑未重新选择资源时保留原有封面和歌词引用", () => {
  const root = fixture();
  try {
    const first = { ...payload(), coverAsset: { name: "source.png", contentBase64: Buffer.from("89504e470d0a1a0a", "hex").toString("base64") }, lyricsAsset: { name: "source.txt", contentBase64: Buffer.from("歌词").toString("base64") } };
    const created = saveEditorWork(root, first);
    const edited = saveEditorWork(root, { ...payload(), revision: created.revision }, "test-work");
    assert.equal(edited.work.cover, "cover.png");
    assert.equal(edited.work.lyrics, "lyrics.txt");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("非法资源不会创建作品目录", () => {
  const root = fixture();
  try {
    assert.throws(() => saveEditorWork(root, { ...payload(), coverAsset: { name: "cover.png", contentBase64: Buffer.from("not-png").toString("base64") } }));
    assert.equal(existsSync(join(contentPaths(root).works, "test-work")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
