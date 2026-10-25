// Tiny static server for local preview: node site/serve.js [port]
const http = require("http"), fs = require("fs"), path = require("path");
const root = __dirname, port = Number(process.env.PORT || process.argv[2] || 5189);
const types = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".js": "text/javascript", ".css": "text/css", ".ico": "image/x-icon" };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`openpump site on http://localhost:${port}`));
