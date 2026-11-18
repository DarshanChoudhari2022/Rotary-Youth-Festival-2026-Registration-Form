const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const register = require('./api/register');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/qr-decoder.js') {
    res.setHeader('Content-Type', types['.js']);
    return fs.createReadStream(require.resolve('jsqr')).pipe(res);
  }
  const handlers = { '/api/register': register, '/api/booking': require('./api/booking'), '/api/scanner': require('./api/scanner'), '/api/scanner-config': require('./api/scanner-config'), '/api/payment': require('./api/payment') };
  handlers['/api/admin'] = require('./api/admin');
  if (Object.hasOwn(handlers, pathname)) {
    if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 65536) {
        res.writeHead(413).end();
        return;
      }
    }
    req.body = body;
    res.status = code => { res.statusCode = code; return res; };
    res.json = data => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    return handlers[pathname](req, res);
  }

  const file = pathname === '/' ? 'index.html' : pathname === '/admin' ? 'admin.html' : pathname.slice(1);
  const allowed = ['admin.html', 'admin.js', 'scanner.html', 'scanner.js', 'register.html', 'event.js', 'index.html', 'styles.css', 'registration.js', 'thank-you.html', 'thank-you.js', 'robots.txt', 'sitemap.xml'].includes(file)
    || /^policies\/[a-z]+\.html$/.test(file)
    || /^assets\/[a-z]+(?:-[a-z]+)*\.(?:png|webp|jpg)$/.test(file);
  const showMissingPage = () => {
    res.writeHead(404, { 'Content-Type': types['.html'] });
    res.end(fs.readFileSync(path.join(__dirname, '404.html')));
  };
  if (!allowed) return showMissingPage();
  fs.readFile(path.join(__dirname, file), (error, content) => {
    if (error) return showMissingPage();
    res.setHeader('Content-Type', types[path.extname(file)]);
    res.end(content);
  });
}).listen(3000, '127.0.0.1', () => {
  console.log('Registration running at http://127.0.0.1:3000');
  console.log('Local configuration is read from .env.local when saving.');
});
