const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../..');

async function startStaticServer() {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/catalog.js': ['catalog.js','text/javascript'], '/workspace.js':['workspace.js','text/javascript'], '/styles.css': ['styles.css', 'text/css'] };
    let file = files[pathname];
    if (/^\/assets\/education-campus-(1100|1672)\.(avif|webp)$/.test(pathname)) {
      file = [pathname.slice(1), 'image/' + path.extname(pathname).slice(1)];
    }
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file[1]);
    res.end(fs.readFileSync(path.join(root, file[0])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, baseURL: 'http://127.0.0.1:' + server.address().port };
}
module.exports = { startStaticServer };
