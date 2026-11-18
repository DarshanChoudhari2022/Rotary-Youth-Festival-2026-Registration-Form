const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync('public', { recursive: true });
fs.copyFileSync(require.resolve('jsqr'), 'public/qr-decoder.js');
function copy(source, destination) {
  if (fs.statSync(source).isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const name of fs.readdirSync(source)) copy(path.join(source, name), path.join(destination, name));
  } else fs.copyFileSync(source, destination);
}
for (const name of fs.readdirSync('.')) {
  if (/\.(html|css)$/.test(name) || ['event.js', 'registration.js', 'thank-you.js', 'scanner.js', 'admin.js', 'robots.txt', 'sitemap.xml', 'assets', 'policies'].includes(name)) copy(name, path.join('public', name));
}
