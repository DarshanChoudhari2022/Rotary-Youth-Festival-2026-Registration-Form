const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const register = require('./api/register');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/api/register') {
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
    return register(req, res);
  }

  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const allowed = ['index.html', 'styles.css', 'registration.js'].includes(file)
    || /^policies\/[a-z]+\.html$/.test(file)
    || /^assets\/[a-z]+\.png$/.test(file);
  if (!allowed) {
    res.writeHead(404).end();
    return;
  }
  fs.readFile(path.join(__dirname, file), (error, content) => {
    if (error) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', types[path.extname(file)]);
    res.end(content);
  });
}).listen(3000, '127.0.0.1', () => {
  console.log('Registration running at http://127.0.0.1:3000');
  console.log('Local configuration is read from .env.local when saving.');
});
