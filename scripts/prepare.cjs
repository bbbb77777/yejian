const fs = require('node:fs');
fs.mkdirSync('web/vendor', {recursive:true});
for (const name of ['index.html','styles.css','app.js','library.js','outline.mjs','highlight-hit.mjs']) fs.copyFileSync(name,`web/${name}`);
fs.cpSync('node_modules/pdfjs-dist/build','web/vendor/pdfjs',{recursive:true});
fs.cpSync('node_modules/katex/dist','web/vendor/katex',{recursive:true});
let js=fs.readFileSync('web/app.js','utf8').replaceAll('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/','./vendor/pdfjs/');
fs.writeFileSync('web/app.js',js);
let html=fs.readFileSync('web/index.html','utf8').replaceAll('https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/','./vendor/katex/').replace(/    <link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\n/g,'');
fs.writeFileSync('web/index.html',html);
