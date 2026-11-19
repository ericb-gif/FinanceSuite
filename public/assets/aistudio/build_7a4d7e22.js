// Builds index.html from the source files: node build.js
const fs = require('fs');
let h = fs.readFileSync('shell.html', 'utf8');
const eng = fs.readFileSync('engine.js', 'utf8');
const app = "const LOGO='" + fs.readFileSync('logo.b64', 'utf8').trim() + "';\n" + ['app.js', 'report.js', 'scorecard.js', 'lookahead.js'].map(f => fs.readFileSync(f, 'utf8')).join('');
const xlsx = '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>';
h = h.replace('/*LOGO*/', () => fs.readFileSync('logo.b64', 'utf8').trim()).replace('<!--XLSX-->', () => xlsx).replace('/*ENGINE*/', () => eng).replace('/*APP*/', () => app);
fs.writeFileSync('index.html', h);
console.log('built index.html', h.length);
