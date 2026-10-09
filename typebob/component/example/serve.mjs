// A tiny static server for the example.
// ES modules need http, not file:// — this is why the example needs a server.
//
//   node component/example/serve.mjs [port]
//   -> http://127.0.0.1:5185/example/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

// served root = the component folder, so /example/ -> example/index.html and
// the page's "../dist/bob.js" import -> /dist/bob.js
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = Number(process.argv[2] || 5185);
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".png": "image/png", ".d.ts": "text/plain",
};

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = join(ROOT, normalize(p).replace(/^(\/|\.\.\/)+/, ""));
    if (!file.startsWith(ROOT)) throw new Error("outside root");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("404");
  }
}).listen(PORT, "127.0.0.1", () => {
  console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}/example/`);
});
