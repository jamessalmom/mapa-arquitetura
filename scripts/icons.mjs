// Resolve o ícone de uma tecnologia, na ordem: shape nativo do draw.io -> Devicon -> Simple Icons -> badge.
// Ícones baixados ficam em cache (~/.cache/mapa-arquitetura/icons) e são embutidos em base64 no .drawio,
// para o arquivo abrir em qualquer lugar sem internet.
// Uso como CLI (teste): node icons.mjs python fastapi n8n aws-s3
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SKILL_DIR, lerJSON } from './_deps.mjs';

const TECH = lerJSON(path.join(SKILL_DIR, 'assets', 'tech-map.json'));
const CACHE = process.env.MAPA_ARQ_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'mapa-arquitetura', 'icons');
fs.mkdirSync(CACHE, { recursive: true });

const AWS_COR = { compute: '#ED7100', storage: '#7AA116', database: '#C925D1', integration: '#E7157B', analytics: '#8C4FFF',
  security: '#DD344C', business: '#DD344C', management: '#E7157B', network: '#8C4FFF', ml: '#01A88D' };

async function baixar(url) {
  try {
    const ctl = AbortSignal.timeout(8000);
    const r = await fetch(url, { signal: ctl });
    if (r.ok) return await r.text();
    if (r.status === 404) return null;
  } catch { /* cai para curl (respeita proxy do sistema) */ }
  try { return execFileSync('curl', ['-fsSL', '--max-time', '10', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch { return null; }
}

async function svgCache(chave, url) {
  const arq = path.join(CACHE, chave.replace(/[^\w.-]/g, '_') + '.svg');
  const neg = arq + '.404';
  if (fs.existsSync(arq)) return fs.readFileSync(arq, 'utf8');
  if (fs.existsSync(neg) && Date.now() - fs.statSync(neg).mtimeMs < 7 * 864e5) return null;
  const svg = await baixar(url);
  if (svg && svg.includes('<svg')) { fs.writeFileSync(arq, svg); return svg; }
  fs.writeFileSync(neg, ''); return null;
}

let deviconIdx = null;
async function variantesDevicon(nome) {
  if (!deviconIdx) {
    const arq = path.join(CACHE, '_devicon.json');
    let txt = fs.existsSync(arq) && Date.now() - fs.statSync(arq).mtimeMs < 30 * 864e5 ? fs.readFileSync(arq, 'utf8') : null;
    if (!txt) { txt = await baixar('https://cdn.jsdelivr.net/gh/devicons/devicon@latest/devicon.json'); if (txt) fs.writeFileSync(arq, txt); }
    deviconIdx = new Map();
    try { for (const d of JSON.parse(txt || '[]')) deviconIdx.set(d.name, d.versions?.svg || []); } catch {}
  }
  return deviconIdx.get(nome) || ['original', 'plain', 'original-wordmark', 'plain-wordmark'];
}

const dataUri = (svg) => 'data:image/svg+xml,' + Buffer.from(svg.replace(/<\?xml[^>]*>/, '').trim()).toString('base64');

async function tentar(spec) {
  if (spec.drawio) {
    const [lib, nome, cat] = spec.drawio.split(':');
    if (lib === 'aws4') return { tipo: 'drawio', fonte: 'drawio/aws4', style: `sketch=0;outlineConnect=0;fontColor=#232F3E;fillColor=${AWS_COR[cat] || '#ED7100'};strokeColor=#ffffff;dashed=0;html=1;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${nome};` };
    if (lib === 'img') return { tipo: 'drawio', fonte: 'drawio/img', style: `image;aspect=fixed;html=1;image=${nome};` };
    return null;
  }
  if (spec.devicon) {
    const vars = await variantesDevicon(spec.devicon);
    const ordem = [spec.variante, 'original', 'plain', 'original-wordmark', 'plain-wordmark', 'line'].filter(v => v && vars.includes(v));
    for (const v of ordem) {
      const svg = await svgCache(`devicon-${spec.devicon}-${v}`, `https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/${spec.devicon}/${spec.devicon}-${v}.svg`);
      if (svg) return { tipo: 'imagem', fonte: `devicon/${spec.devicon}-${v}`, dataUri: dataUri(svg) };
    }
    return null;
  }
  if (spec.si) {
    let svg = await svgCache(`si-${spec.si}`, `https://cdn.simpleicons.org/${spec.si}`);
    if (!svg) {
      svg = await svgCache(`si-jsd-${spec.si}`, `https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/${spec.si}.svg`);
      if (svg && spec.cor) svg = svg.replace('<svg ', `<svg fill="${spec.cor}" `);
    }
    if (svg) return { tipo: 'imagem', fonte: `simpleicons/${spec.si}`, dataUri: dataUri(svg) };
    return null;
  }
  if (spec.url) { // ícone customizado declarado no mapa (ex.: logo do próprio projeto)
    const svg = await svgCache(`url-${Buffer.from(spec.url).toString('base64url').slice(0, 40)}`, spec.url);
    if (svg) return { tipo: 'imagem', fonte: spec.url, dataUri: dataUri(svg) };
  }
  if (spec.arquivo && fs.existsSync(spec.arquivo)) {
    const buf = fs.readFileSync(spec.arquivo); const ext = path.extname(spec.arquivo).slice(1).toLowerCase();
    if (ext === 'svg') return { tipo: 'imagem', fonte: spec.arquivo, dataUri: dataUri(buf.toString('utf8')) };
    return { tipo: 'imagem', fonte: spec.arquivo, dataUri: `data:image/${ext === 'jpg' ? 'jpeg' : ext},${buf.toString('base64')}` };
  }
  return null;
}

const memo = new Map();
/** chave: chave do tech-map (ex.: "postgresql") OU objeto spec ({devicon}|{si}|{drawio}|{url}|{arquivo}). */
export async function resolverIcone(chave) {
  const id = typeof chave === 'string' ? chave : JSON.stringify(chave);
  if (memo.has(id)) return memo.get(id);
  let res = null; let nome = typeof chave === 'string' ? chave : '';
  if (typeof chave === 'string') {
    const t = TECH[chave];
    if (t) { nome = t.nome; for (const spec of t.icone || []) { res = await tentar(spec); if (res) break; } }
    else { // chave desconhecida: tenta adivinhar pelo nome em Devicon e Simple Icons
      const slug = chave.toLowerCase().replace(/[^a-z0-9]/g, '');
      res = (await tentar({ devicon: slug })) || (await tentar({ si: slug }));
    }
  } else res = await tentar(chave);
  res ||= { tipo: 'badge', fonte: 'badge', texto: nome };
  memo.set(id, res);
  return res;
}

export function nomeTec(chave) { return TECH[chave]?.nome || chave; }
export function infoTec(chave) { return TECH[chave]; }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  for (const c of process.argv.slice(2)) { const r = await resolverIcone(c); console.log(c.padEnd(18), r.tipo.padEnd(7), r.fonte); }
}
