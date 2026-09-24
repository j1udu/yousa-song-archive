import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { IndexedWork, TagCatalog } from "../src/content/types";
import { mergePeople } from "../src/content/types";
import {
  applyQuery,
  availableYears,
  buildTagLookup,
  cardVersions,
  orderedVersions,
  pageWindow,
  paginate,
  parseQuery,
  searchFields,
  serializeQuery,
  sortWorks,
} from "../src/catalog/query";

const catalog: TagCatalog = {
  schemaVersion: 1,
  groups: [
    { id: "b", name: "B 组", order: 2, tags: [{ id: "b2", name: "B2", order: 2 }, { id: "b1", name: "B1", order: 1 }] },
    { id: "a", name: "A 组", order: 1, tags: [{ id: "a1", name: "A1", order: 1 }, { id: "a2", name: "A2", order: 2 }] },
  ],
};
const lookup = buildTagLookup(catalog);

function work(partial: Partial<IndexedWork> & { id: string }): IndexedWork {
  return {
    schemaVersion: 1,
    title: partial.id,
    aliases: [],
    year: null,
    tags: [],
    people: {},
    cover: null,
    lyrics: null,
    summary: "",
    versionOrder: [],
    featuredVersions: [],
    path: `content/works/${partial.id}/work.json`,
    coverUrl: null,
    lyricsUrl: null,
    versions: [],
    ...partial,
  };
}

const works: IndexedWork[] = [
  work({ id: "w1", title: "夜航星", aliases: ["Night Star"], year: 2024, tags: ["a1", "b1"], people: { 作曲: ["张三"] }, versions: [{ id: "v1", name: "演唱会现场", type: "现场", date: "2024", path: "" }], versionOrder: ["v1"] }),
  work({ id: "w2", title: "Alpha", year: 2020, tags: ["a2", "b1"], people: { 演唱: ["李四"] } }),
  work({ id: "w3", title: "北风", year: null, tags: ["a1"] }),
  work({ id: "w4", title: "安静", year: 2024, tags: ["a2", "b2"] }),
];

describe("tag lookup", () => {
  it("sorts groups and tags by configured order", () => {
    assert.deepEqual(lookup.groups.map((group) => group.id), ["a", "b"]);
    assert.deepEqual(lookup.groups[1]!.tags.map((tag) => tag.id), ["b1", "b2"]);
    assert.equal(lookup.byId.get("b1")?.groupIndex, 1);
  });
});

describe("parseQuery / serializeQuery", () => {
  it("returns defaults for an empty query string", () => {
    const query = parseQuery(new URLSearchParams(""), lookup);
    assert.deepEqual(query, { q: "", year: "", tags: [], sort: "year-desc", page: 1 });
    assert.equal(serializeQuery(query), "");
  });

  it("keeps repeated tag params, drops unknown tags and invalid values", () => {
    const query = parseQuery(new URLSearchParams("q=%E5%A4%9C&tag=a1&tag=zzz&tag=b2&tag=a1&year=20x4&sort=bogus&page=-3"), lookup);
    assert.deepEqual(query, { q: "夜", year: "", tags: ["a1", "b2"], sort: "year-desc", page: 1 });
  });

  it("round-trips a full query and omits defaults", () => {
    const query = parseQuery(new URLSearchParams("q=a+b&year=2024&tag=a1&tag=b1&sort=title-asc&page=3"), lookup);
    assert.equal(serializeQuery(query), "q=a+b&year=2024&tag=a1&tag=b1&sort=title-asc&page=3");
    assert.equal(serializeQuery({ ...query, page: 1, sort: "year-desc" }), "q=a+b&year=2024&tag=a1&tag=b1");
  });
});

describe("search", () => {
  it("covers title, aliases, people and version names", () => {
    assert.deepEqual(applyQuery(works, { q: "夜航", year: "", tags: [], sort: "year-desc", page: 1 }, lookup).map((w) => w.id), ["w1"]);
    assert.deepEqual(applyQuery(works, { q: "night", year: "", tags: [], sort: "year-desc", page: 1 }, lookup).map((w) => w.id), ["w1"]);
    assert.deepEqual(applyQuery(works, { q: "张三", year: "", tags: [], sort: "year-desc", page: 1 }, lookup).map((w) => w.id), ["w1"]);
    assert.deepEqual(applyQuery(works, { q: "演唱会", year: "", tags: [], sort: "year-desc", page: 1 }, lookup).map((w) => w.id), ["w1"]);
  });

  it("includes version-level people when the caller supplies them", () => {
    const query = { q: "壬", year: "", tags: [], sort: "year-desc" as const, page: 1 };
    assert.deepEqual(applyQuery(works, query, lookup), []);
    const versionPeople = new Map([["w2", ["测试和声者壬"]]]);
    assert.deepEqual(applyQuery(works, query, lookup, { versionPeople }).map((w) => w.id), ["w2"]);
    assert.deepEqual(applyQuery(works, { ...query, q: "alpha 壬" }, lookup, { versionPeople }).map((w) => w.id), ["w2"]);
    assert.deepEqual(applyQuery(works, { ...query, q: "夜航 壬" }, lookup, { versionPeople }), []);
  });

  it("treats whitespace-separated terms as AND, case-insensitive and NFKC-normalised", () => {
    assert.deepEqual(applyQuery(works, { q: "ＡLPHA", year: "", tags: [], sort: "year-desc", page: 1 }, lookup).map((w) => w.id), ["w2"]);
    assert.deepEqual(applyQuery(works, { q: "夜航 张三", year: "", tags: [], sort: "year-desc", page: 1 }, lookup).map((w) => w.id), ["w1"]);
    assert.deepEqual(applyQuery(works, { q: "夜航 李四", year: "", tags: [], sort: "year-desc", page: 1 }, lookup), []);
    assert.ok(searchFields(works[0]!).includes("night star"));
  });
});

describe("tag and year filters", () => {
  it("uses OR inside a group and AND across groups", () => {
    const ids = (tags: string[]): string[] => applyQuery(works, { q: "", year: "", tags, sort: "title-asc", page: 1 }, lookup).map((w) => w.id);
    assert.deepEqual(ids(["a1", "a2"]).sort(), ["w1", "w2", "w3", "w4"]);
    assert.deepEqual(ids(["a1", "b1"]), ["w1"]);
    assert.deepEqual(ids(["a1", "a2", "b2"]), ["w4"]);
    assert.deepEqual(ids(["b1", "b2"]).sort(), ["w1", "w2", "w4"]);
  });

  it("filters by the work year only", () => {
    const ids = applyQuery(works, { q: "", year: "2024", tags: [], sort: "title-asc", page: 1 }, lookup).map((w) => w.id);
    assert.deepEqual(ids, ["w4", "w1"]);
    assert.deepEqual(availableYears(works), [2024, 2020]);
  });
});

describe("sorting", () => {
  it("puts unknown years last in both directions", () => {
    assert.deepEqual(sortWorks(works, "year-desc").map((w) => w.id), ["w4", "w1", "w2", "w3"]);
    assert.deepEqual(sortWorks(works, "year-asc").map((w) => w.id), ["w2", "w4", "w1", "w3"]);
  });

  it("sorts titles with locale collation", () => {
    assert.deepEqual(sortWorks(works, "title-asc").map((w) => w.title), ["Alpha", "安静", "北风", "夜航星"]);
    assert.deepEqual(sortWorks(works, "title-desc").map((w) => w.title), ["夜航星", "北风", "安静", "Alpha"]);
  });
});

describe("pagination", () => {
  it("clamps out-of-range pages and uses 24 per page", () => {
    const items = Array.from({ length: 60 }, (_, index) => index + 1);
    assert.deepEqual(paginate(items, 1).items.length, 24);
    assert.deepEqual(paginate(items, 3).items, [49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    assert.equal(paginate(items, 99).page, 3);
    assert.equal(paginate(items, 0).page, 1);
    assert.equal(paginate([], 5).pages, 1);
  });

  it("builds a compact page window", () => {
    assert.deepEqual(pageWindow(1, 3), [1, 2, 3]);
    assert.deepEqual(pageWindow(5, 20), [1, "gap", 4, 5, 6, "gap", 20]);
    assert.deepEqual(pageWindow(1, 20), [1, 2, 3, 4, "gap", 20]);
    assert.deepEqual(pageWindow(20, 20), [1, "gap", 17, 18, 19, 20]);
  });
});

describe("card versions", () => {
  const versions = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase(), type: "t", date: null, path: "" }));

  it("falls back to the first three of versionOrder when featuredVersions is empty", () => {
    const item = work({ id: "w", versions: [...versions].reverse(), versionOrder: ["a", "b", "c", "d", "e"] });
    assert.deepEqual(orderedVersions(item).map((v) => v.id), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(cardVersions(item).shown.map((v) => v.id), ["a", "b", "c"]);
  });

  it("uses featuredVersions in their own order, capped at three", () => {
    const item = work({ id: "w", versions, versionOrder: ["a", "b", "c", "d", "e"], featuredVersions: ["e", "b"] });
    assert.deepEqual(cardVersions(item).shown.map((v) => v.id), ["e", "b"]);
    const capped = work({ id: "w", versions, versionOrder: ["a", "b", "c", "d", "e"], featuredVersions: ["e", "d", "c", "b"] });
    assert.deepEqual(cardVersions(capped).shown.map((v) => v.id), ["e", "d", "c"]);
  });
});

describe("mergePeople", () => {
  it("inherits, replaces and clears roles", () => {
    const merged = mergePeople({ 演唱: ["甲"], 作词: ["乙"], 编曲: ["丁"] }, { 演唱: ["庚", "辛"], 编曲: [], 和声: ["壬"] });
    assert.deepEqual(merged, { 演唱: ["庚", "辛"], 作词: ["乙"], 编曲: [], 和声: ["壬"] });
  });
});
