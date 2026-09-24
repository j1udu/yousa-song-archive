import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildWorkIndex, ContentValidationError, contentPaths } from "../scripts/content-lib";
import type { AudioAsset, Version, Work } from "../src/content/types";

function validateWithAudio(audio: AudioAsset[], authorized: boolean) {
  const root = mkdtempSync(join(tmpdir(), "yousa-release-test-"));
  try {
    const paths = contentPaths(root);
    const dir = join(paths.works, "test-work");
    mkdirSync(dir, { recursive: true });
    writeFileSync(paths.tags, JSON.stringify({ schemaVersion: 1, groups: [] }));
    const work: Work = { schemaVersion: 1, id: "test-work", title: "测试", aliases: [], year: null, tags: [], people: {}, cover: null, lyrics: null, summary: "", versionOrder: ["v01"], featuredVersions: [] };
    const version: Version = { schemaVersion: 1, id: "v01", name: "正式版", type: "正式版", date: null, people: {}, links: [], audio, audioRights: authorized ? "authorized" : null, notes: "" };
    writeFileSync(join(dir, "work.json"), JSON.stringify(work));
    writeFileSync(join(dir, "version-v01.json"), JSON.stringify(version));
    return buildWorkIndex(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const release = "https://github.com/j1udu/yousa-song-archive/releases/download/audio-flac-v1/test-work-v01.flac";

test("授权音频可引用远程 Release 附件，不需要站内音频文件", () => {
  assert.equal(validateWithAudio([{ quality: "FLAC 无损", url: release, format: "flac", size: 1234, sha256: "a".repeat(64) }], true).index.works.length, 1);
});

test("远程音频链接要求 HTTPS 和分发授权", () => {
  const audio: AudioAsset[] = [{ quality: "FLAC 无损", url: release, format: "flac" }];
  assert.throws(() => validateWithAudio(audio, false), (error) => error instanceof ContentValidationError && /分发权/.test(error.message));
  assert.throws(() => validateWithAudio([{ ...audio[0], url: "http://example.com/audio.flac" }], true), (error) => error instanceof ContentValidationError && /HTTPS/.test(error.message));
});
