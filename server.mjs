import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const base=path.dirname(fileURLToPath(import.meta.url));
http.createServer(async(req,res)=>{try{const target=path.resolve(base,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!target.startsWith(base+path.sep)&&target!==base)throw Error();const file=target===base?path.join(base,'index.html'):target;const data=await readFile(file);res.setHeader('Content-Type',({'html':'text/html; charset=utf-8','js':'text/javascript','mjs':'text/javascript','css':'text/css','png':'image/png'})[file.split('.').pop()]||'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(5178,'127.0.0.1',()=>console.log('TIME3 preview: http://127.0.0.1:5178'));
