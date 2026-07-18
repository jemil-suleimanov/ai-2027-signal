import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import './build.mjs';
const root = new URL('../dist/', import.meta.url).pathname;
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json'};
createServer(async (req,res) => { try { let path=join(root,decodeURIComponent(req.url.split('?')[0])); if((await stat(path)).isDirectory()) path=join(path,'index.html'); res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream'); res.end(await readFile(path)); } catch { res.statusCode=404; res.end('Not found'); } }).listen(4173,()=>console.log('http://localhost:4173'));
