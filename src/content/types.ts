export type RoleMap = Record<string, string[]>;

export interface Tag {
  id: string;
  name: string;
  order: number;
}

export interface TagGroup {
  id: string;
  name: string;
  order: number;
  tags: Tag[];
}

export interface TagCatalog {
  schemaVersion: 1;
  groups: TagGroup[];
}

export interface Link {
  platform: string;
  url: string;
  label: string;
}

export interface AudioAsset {
  quality: string;
  /** 站内音频文件。与 url 至少提供一个。 */
  file?: string;
  /** GitHub Release 等远程下载地址。与 file 至少提供一个。 */
  url?: string;
  format: "mp3" | "flac";
  size?: number;
  sha256?: string;
}

export interface Work {
  schemaVersion: 1;
  id: string;
  title: string;
  aliases: string[];
  year: number | null;
  tags: string[];
  people: RoleMap;
  cover: string | null;
  lyrics: string | null;
  summary: string;
  versionOrder: string[];
  featuredVersions: string[];
}

export interface Version {
  schemaVersion: 1;
  id: string;
  name: string;
  type: string;
  date: string | null;
  people: RoleMap;
  links: Link[];
  audio?: AudioAsset[];
  audioRights?: "authorized" | null;
  notes: string;
}

export interface VersionSummary {
  id: string;
  name: string;
  type: string;
  date: string | null;
  path: string;
}

export interface IndexedWork extends Work {
  path: string;
  coverUrl: string | null;
  lyricsUrl: string | null;
  versions: VersionSummary[];
}

export interface WorkIndex {
  schemaVersion: 1;
  works: IndexedWork[];
}

export function mergePeople(work: RoleMap, override: RoleMap): RoleMap {
  const merged: RoleMap = Object.fromEntries(Object.entries(work).map(([role, people]) => [role, [...people]]));
  for (const [role, people] of Object.entries(override)) merged[role] = [...people];
  return merged;
}
