import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkIndex } from "./content-lib";
import { AdminError, checkId, readEditorTags, readEditorWork, saveEditorTags, saveEditorWork, validateEditorBuild } from "./admin-content";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
async function body(req: IncomingMessage): Promise<any> { if (!req.headers["content-type"]?.startsWith("application/json")) throw new AdminError("请求须使用 JSON", 415); const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new AdminError("请求体超过 16 MB", 413); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }

export function createAdminServer(root: string) {
  const token = randomBytes(32).toString("hex"); let busy = false;
  const server = createServer(async (req, res) => {
    const json = (status: number, value: unknown) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
    res.setHeader("cache-control", "no-store"); res.setHeader("x-content-type-options", "nosniff"); res.setHeader("content-security-policy", "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; frame-ancestors 'none'");
    try {
      const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; const host = req.headers.host;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new AdminError("主机不允许", 403);
      const origin = `http://${host}`; if ((req.headers.origin && req.headers.origin !== origin) || req.headers["sec-fetch-site"] === "cross-site") throw new AdminError("不允许跨站请求", 403);
      const path = new URL(req.url ?? "/", origin).pathname;
      if (req.method === "GET" && path === "/api/session") return json(200, { token });
      if (path.startsWith("/api/")) {
        if (req.headers["x-admin-token"] !== token) throw new AdminError("管理会话已失效，请刷新页面", 403);
        if (req.method === "GET" && path === "/api/works") return json(200, buildWorkIndex(root).index.works);
        if (req.method === "GET" && path === "/api/tags") return json(200, readEditorTags(root));
        const match = path.match(/^\/api\/works\/([^/]+)$/); const id = match ? decodeURIComponent(match[1]) : undefined; if (id) checkId(id);
        if (req.method === "GET" && id) return json(200, readEditorWork(root, id));
        if (busy) throw new AdminError("另一项保存或检查正在进行，请稍后重试", 409);
        busy = true;
        try { const input = await body(req); if (req.method === "POST" && path === "/api/works") return json(201, saveEditorWork(root, input)); if (req.method === "PUT" && id) return json(200, saveEditorWork(root, input, id)); if (req.method === "PUT" && path === "/api/tags") return json(200, saveEditorTags(root, input.tags, input.revision)); if (req.method === "POST" && path === "/api/validate") return json(200, await validateEditorBuild(root, projectRoot)); return json(404, { error: "接口不存在" }); } finally { busy = false; }
      }
      const files: Record<string, [string, string]> = { "/": ["index.html", "text/html"], "/admin.css": ["admin.css", "text/css"], "/admin.js": ["admin.js", "text/javascript"] };
      if (req.method !== "GET" || !files[path]) return json(404, { error: "页面不存在" }); const [file, mime] = files[path]; res.writeHead(200, { "content-type": `${mime}; charset=utf-8` }); res.end(readFileSync(join(projectRoot, "admin", file)));
    } catch (error) { json(error instanceof AdminError ? error.status : 400, { error: error instanceof Error ? error.message : String(error) }); }
  }); return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const root = resolve(process.env.SONG_ARCHIVE_ROOT ?? projectRoot); const requestedPort = Number(process.env.ADMIN_PORT ?? 4317); const server = createAdminServer(root); let port = requestedPort; server.on("error", (error: NodeJS.ErrnoException) => { if (error.code === "EADDRINUSE" && port < requestedPort + 20) server.listen(++port, "127.0.0.1"); else { console.error(error.message); process.exitCode = 1; } }); server.on("listening", () => console.log(`曲库管理工具：http://127.0.0.1:${port}\n内容目录：${root}/public/content`)); server.listen(port, "127.0.0.1"); }
