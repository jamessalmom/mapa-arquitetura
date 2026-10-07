#!/usr/bin/env node
// Gera arquitetura.html: um arquivo único que mostra cada página do diagrama EXATAMENTE como na imagem
// (usa o próprio SVG exportado pelo draw.io) e acrescenta interatividade por cima: abas por visão, zoom e
// arrasto, clique em nó/seta/grupo para ver detalhes (tecnologias, conexões, evidências), busca e links
// diretos (#v=<pagina>&i=<item>).
// Uso: node html.mjs <pasta-de-saida> [--saida arquivo.html] [--modo auto|svg|viewer]
//   svg    = offline, usa imagens/NN-*.svg (gerados pelo export.mjs). É o modo padrão.
//   viewer = sem SVG exportado (draw.io desktop ausente): renderiza o .drawio com o visualizador oficial do
//            draw.io (mesmo motor, mesmo visual), mas precisa de internet ao abrir o HTML.
// Saída 0 = ok; 1 = erro de uso/arquivos; 4 = SVGs desatualizados em relação ao .drawio (rode export.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { carregarMapa, derivarVisao, mascarador, paleta, TIPO_ROTULO, CAMADA_ROTULO, ehInterno } from './_mapa.mjs';
import { nomeTec } from './icons.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const pasta = args.find((a, i) => !a.startsWith('--') && !['--saida', '--modo'].includes(args[i - 1]));
if (!pasta) { console.error('Uso: node html.mjs <pasta-de-saida> [--saida arquivo.html] [--modo auto|svg|viewer]'); process.exit(1); }
const OUT = path.resolve(pasta);
const arqMapa = path.join(OUT, 'mapa.json'), arqDrawio = path.join(OUT, 'arquitetura.drawio');
const arqSaida = path.resolve(opt('--saida', path.join(OUT, 'arquitetura.html')));
let modo = opt('--modo', 'auto');
for (const a of [arqMapa, arqDrawio]) if (!fs.existsSync(a)) { console.error(`[html] Não encontrei ${a}. Gere o diagrama antes (build-drawio.mjs).`); process.exit(1); }

const mapa = carregarMapa(arqMapa);
const mask = mascarador(mapa);
const escuro = mapa.projeto.tema === 'escuro';
const PAL = paleta(escuro);
const xml = fs.readFileSync(arqDrawio, 'utf8');
const desesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const san = (v) => v.replace(/[^\w]/g, '_');

// ---------- páginas do .drawio, na ordem em que foram geradas ----------
const diagramas = [...xml.matchAll(/<diagram\s+name="([^"]*)"\s+id="([^"]*)"/g)].map(m => ({ aba: desesc(m[1]), idPagina: m[2] }));
const visaoPorId = new Map(mapa.visoes.map(v => [`${san(v)}__`.replace(/_+$/, ''), v]));
const paginas = diagramas.map((d, i) => {
  const visao = visaoPorId.get(d.idPagina);
  if (!visao) { console.error(`[html] A página "${d.aba}" do .drawio não corresponde a nenhuma visão do mapa.json. Gere o .drawio de novo.`); process.exit(1); }
  return { i, visao, aba: d.aba, idPagina: d.idPagina, prefixo: `${san(visao)}__` };
});

// ---------- SVGs exportados ----------
const pastaImg = path.join(OUT, 'imagens');
const tDrawio = fs.statSync(arqDrawio).mtimeMs;
const svgDe = (i) => {
  try { const f = fs.readdirSync(pastaImg).find(n => n.startsWith(String(i + 1).padStart(2, '0') + '-') && n.endsWith('.svg')); return f ? path.join(pastaImg, f) : null; } catch { return null; }
};
const svgs = paginas.map(p => svgDe(p.i));
const temTodos = svgs.every(Boolean);
const atualizados = temTodos && svgs.every(f => fs.statSync(f).mtimeMs >= tDrawio - 2000);
if (modo === 'auto') modo = atualizados ? 'svg' : 'viewer';
if (modo === 'svg' && !temTodos) { console.error('[html] Faltam SVGs em imagens/. Rode export.mjs antes ou use --modo viewer.'); process.exit(1); }
if (modo === 'svg' && !atualizados) { console.error('[html] Os SVGs de imagens/ são mais antigos que o arquitetura.drawio. Rode export.mjs de novo (ou use --modo viewer).'); process.exit(4); }

// data URIs repetidos (logos) viram referências: o mesmo logo em várias páginas é guardado uma vez só
const uris = [], idxUri = new Map();
const compactar = (s) => s.replace(/data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/g, (u) => {
  if (!idxUri.has(u)) { idxUri.set(u, uris.length); uris.push(u); }
  return `data:x-ref,${idxUri.get(u)}`;
});
const limparSvg = (t) => t.replace(/<\?xml[^>]*>/, '').replace(/<!DOCTYPE[^>]*>/i, '').trim();

// ---------- entidades clicáveis de cada página ----------
const porId = new Map(mapa.nos.map(n => [n.id, n]));
const camadaRot = (c) => CAMADA_ROTULO[c] || c;
const corCamada = (c) => (PAL.camada[c] || PAL.camada.aplicacao)[1];
function entidades(visao) {
  const v = derivarVisao(mapa, visao);
  const nos = {}, arestas = {}, grupos = {};
  for (const n of v.nos) {
    const e = {
      id: n.id, nome: mask(n.nome), tipo: TIPO_ROTULO[n.tipo] || n.tipo, camada: n.camada, camadaRotulo: camadaRot(n.camada), cor: corCamada(n.camada),
      tecs: (n.tecnologias || []).map(nomeTec), descricao: mask(n.descricao || ''), evidencias: (n.evidencias || []).map(mask),
      vizinho: !!n._vizinho, entrada: [], saida: []
    };
    if (n.id === '__sistema') {
      e.internos = mapa.nos.filter(x => ehInterno(x) && x.tipo !== 'componente').map(x => mask(x.nome));
      e.descricao = mask(mapa.projeto.descricao || '');
    }
    if (n.pai && porId.get(n.pai)) e.pai = mask(porId.get(n.pai).nome);
    nos[n.id] = e;
  }
  for (const c of v.conexoes) {
    const itens = (c._itens || [c]).map(x => ({
      de: mask(porId.get(x.de)?.nome || x.de), para: mask(porId.get(x.para)?.nome || x.para),
      protocolo: mask(x.protocolo || ''), acao: mask(x.acao || ''), modo: x.modo || 'sincrono',
      descricao: mask(x.descricao || ''), evidencias: (x.evidencias || []).map(mask)
    }));
    arestas[c.id] = { id: c.id, de: c.de, para: c.para, rotulo: mask(c.rotulo ?? [c.protocolo, c.acao].filter(Boolean).join(' · ')), modo: c.modo, numero: c.numero, itens };
    nos[c.de]?.saida.push(c.id); nos[c.para]?.entrada.push(c.id);
  }
  for (const g of v.grupos) {
    const membros = v.nos.filter(n => n.grupo === g.id).map(n => n.id);
    grupos[g.id] = { id: g.id, nome: mask(g.nome), tipo: g.tipo || 'grupo', membros, container: g._container ? g.id.replace(/^__cont_/, '') : null };
    if (g._container) { const cn = porId.get(grupos[g.id].container); grupos[g.id].descricao = mask(cn?.descricao || ''); grupos[g.id].tecs = (cn?.tecnologias || []).map(nomeTec); }
  }
  return { titulo: v.titulo, subtitulo: v.subtitulo, nos, arestas, grupos, numerada: !!v.numerada };
}

const dados = {
  projeto: { nome: mask(mapa.projeto.nome), descricao: mask(mapa.projeto.descricao || ''), versao: mapa.projeto.versao || '', tema: escuro ? 'escuro' : 'claro' },
  geradoEm: new Date().toISOString().slice(0, 10),
  modo,
  paleta: { fundo: PAL.fundo, texto: PAL.texto, textoSec: PAL.textoSec, seta: PAL.seta },
  paginas: paginas.map((p, k) => ({ ...p, ...entidades(p.visao), svg: modo === 'svg' ? compactar(limparSvg(fs.readFileSync(svgs[k], 'utf8'))) : null })),
  uris,
  xml: modo === 'viewer' ? xml : null
};

const json = JSON.stringify(dados).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const T = escuro
  ? { fundo: PAL.fundo, barra: '#111827', borda: '#1F2937', texto: '#E5E7EB', sec: '#9CA3AF', sup: '#1F2937', supHover: '#273449', acento: '#60A5FA', acentoFraco: 'rgba(96,165,250,.16)', sombra: '0 10px 30px rgba(0,0,0,.45)' }
  : { fundo: PAL.fundo, barra: '#FFFFFF', borda: '#E5E7EB', texto: '#111827', sec: '#6B7280', sup: '#F3F4F6', supHover: '#E5E7EB', acento: '#2563EB', acentoFraco: 'rgba(37,99,235,.10)', sombra: '0 10px 30px rgba(15,23,42,.14)' };

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(dados.projeto.nome)} · Arquitetura</title>
<style>
:root{--fundo:${T.fundo};--barra:${T.barra};--borda:${T.borda};--texto:${T.texto};--sec:${T.sec};--sup:${T.sup};--sup-h:${T.supHover};--acento:${T.acento};--acento-f:${T.acentoFraco};--sombra:${T.sombra};color-scheme:${escuro ? 'dark' : 'light'}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:var(--fundo);color:var(--texto);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
button,input{font:inherit;color:inherit}
#barra{position:fixed;inset:0 0 auto 0;height:52px;display:flex;align-items:center;gap:12px;padding:0 12px 0 16px;background:var(--barra);border-bottom:1px solid var(--borda);z-index:5}
#marca{display:flex;flex-direction:column;min-width:0;max-width:220px}
#marca b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#marca span{font-size:11px;color:var(--sec);white-space:nowrap}
#abas{display:flex;gap:4px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
#abas::-webkit-scrollbar{display:none}
.aba{border:0;background:transparent;padding:7px 12px;border-radius:8px;cursor:pointer;white-space:nowrap;color:var(--sec)}
.aba:hover{background:var(--sup)}
.aba[aria-selected=true]{background:var(--acento-f);color:var(--acento);font-weight:600}
#busca{position:relative}
#busca input{width:200px;height:34px;padding:0 10px 0 30px;border:1px solid var(--borda);border-radius:8px;background:var(--fundo);outline:none}
#busca input:focus{border-color:var(--acento);box-shadow:0 0 0 3px var(--acento-f)}
#busca svg{position:absolute;left:9px;top:10px;opacity:.55}
#resultados{position:absolute;right:0;top:40px;width:320px;max-height:360px;overflow:auto;background:var(--barra);border:1px solid var(--borda);border-radius:10px;box-shadow:var(--sombra);padding:4px;display:none}
#resultados.aberto{display:block}
.res{display:block;width:100%;text-align:left;border:0;background:transparent;padding:7px 10px;border-radius:7px;cursor:pointer}
.res:hover,.res.ativo{background:var(--sup)}
.res small{display:block;color:var(--sec);font-size:11.5px}
#zoom{display:flex;align-items:center;border:1px solid var(--borda);border-radius:8px;overflow:hidden}
#zoom button{border:0;background:transparent;width:32px;height:32px;cursor:pointer;font-size:16px}
#zoom button:hover{background:var(--sup)}
#zoom #pct{width:auto;padding:0 8px;font-size:12px;font-variant-numeric:tabular-nums;min-width:52px}
#area{position:fixed;inset:52px 0 0 0;overflow:hidden;cursor:grab;touch-action:none}
#area.arrastando{cursor:grabbing}
#palco{position:absolute;left:0;top:0;transform-origin:0 0}
#palco>svg{display:block}
#dica{position:fixed;left:12px;bottom:10px;font-size:11.5px;color:var(--sec);background:var(--barra);border:1px solid var(--borda);padding:4px 9px;border-radius:7px;opacity:.92;pointer-events:none}
[data-ref]{cursor:pointer}
.mx-no,.mx-aresta{transition:opacity .18s}
.mx-no:hover{filter:drop-shadow(0 3px 8px rgba(15,23,42,.22))}
.mx-aresta:hover path:not(.hit){stroke:var(--acento)!important}
.mx-aresta:hover path[fill]:not([fill=none]):not(.hit){fill:var(--acento)!important}
.sel.mx-no{filter:drop-shadow(0 0 3px var(--acento)) drop-shadow(0 0 3px var(--acento))}
.sel.mx-aresta path:not(.hit){stroke:var(--acento)!important;stroke-width:2.6px}
.sel.mx-aresta path[fill]:not([fill=none]):not(.hit){fill:var(--acento)!important}
.apagado{opacity:.13}
path.hit{fill:none!important;stroke:transparent!important;stroke-width:16px!important;pointer-events:stroke}
#painel{position:fixed;top:64px;right:12px;bottom:12px;width:370px;max-width:calc(100vw - 24px);background:var(--barra);border:1px solid var(--borda);border-radius:14px;box-shadow:var(--sombra);transform:translateX(calc(100% + 24px));transition:transform .22s ease;z-index:6;display:flex;flex-direction:column}
#painel.aberto{transform:none}
#painel header{display:flex;align-items:flex-start;gap:10px;padding:16px 16px 10px}
#painel header .tit{flex:1;min-width:0}
#painel h2{font-size:17px;margin:2px 0 0;line-height:1.3;overflow-wrap:anywhere}
#fechar{border:0;background:var(--sup);width:30px;height:30px;border-radius:8px;cursor:pointer;flex:none}
#fechar:hover{background:var(--sup-h)}
#corpo{padding:0 16px 16px;overflow:auto}
.chip{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:var(--sec)}
.chip i{width:10px;height:10px;border-radius:3px;border:2px solid;display:inline-block}
.desc{margin:6px 0 12px}
h3{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--sec);margin:16px 0 6px;font-weight:600}
.pills{display:flex;flex-wrap:wrap;gap:6px}
.pill{background:var(--sup);border-radius:999px;padding:3px 10px;font-size:12.5px}
.lista{display:flex;flex-direction:column;gap:4px}
.item{display:block;width:100%;text-align:left;border:1px solid var(--borda);background:transparent;border-radius:9px;padding:8px 10px;cursor:pointer}
.item:hover{background:var(--sup);border-color:var(--sup-h)}
.item small{display:block;color:var(--sec);font-size:12px;margin-top:1px}
.modo{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;border:1px solid var(--borda);color:var(--sec);margin-left:6px;vertical-align:1px}
code,.ev{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.ev{background:var(--sup);border-radius:6px;padding:2px 7px;display:inline-block;margin:0 4px 4px 0;overflow-wrap:anywhere}
.passo{border-left:3px solid var(--acento);padding:4px 0 4px 10px;margin:6px 0}
.vazio{color:var(--sec);font-size:13px}
#aviso{position:fixed;inset:52px 0 0 0;display:none;align-items:center;justify-content:center;text-align:center;padding:24px;color:var(--sec)}
@media (max-width:760px){
  #marca{display:none}
  #busca input{width:130px}
  #zoom #pct{display:none}
  #painel{top:auto;left:8px;right:8px;width:auto;height:58vh;transform:translateY(calc(100% + 24px))}
  #dica{display:none}
}
@media print{#barra,#painel,#dica{display:none}#area{inset:0}}
</style>
</head>
<body>
<header id="barra">
  <div id="marca"><b></b><span></span></div>
  <nav id="abas" role="tablist" aria-label="Visões"></nav>
  <div id="busca">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="q" type="search" placeholder="Buscar peça…" autocomplete="off" aria-label="Buscar peça">
    <div id="resultados" role="listbox"></div>
  </div>
  <div id="zoom">
    <button id="menos" title="Diminuir (−)" aria-label="Diminuir zoom">−</button>
    <button id="pct" title="Tamanho real (1)">100%</button>
    <button id="mais" title="Aumentar (+)" aria-label="Aumentar zoom">+</button>
    <button id="ajustar" title="Ajustar à tela (0)" aria-label="Ajustar à tela"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg></button>
  </div>
</header>
<main id="area" aria-label="Diagrama"><div id="palco"></div></main>
<div id="aviso"></div>
<div id="dica">Clique numa peça ou seta para ver detalhes · arraste para mover · roda do mouse para zoom</div>
<aside id="painel" aria-live="polite">
  <header><div class="tit"><div id="pchip" class="chip"></div><h2 id="ptit"></h2></div><button id="fechar" aria-label="Fechar">✕</button></header>
  <div id="corpo"></div>
</aside>
<script id="dados" type="application/json">${json}</script>
<script>
(() => {
const D = JSON.parse(document.getElementById('dados').textContent);
const $ = (s) => document.querySelector(s);
const area = $('#area'), palco = $('#palco'), painel = $('#painel'), corpo = $('#corpo');
const h = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let atual = -1, svg = null, larg = 1, alt = 1, vis = { x: 0, y: 0, s: 1 }, selecao = null, pecas = new Map();

$('#marca b').textContent = D.projeto.nome;
$('#marca span').textContent = 'Arquitetura' + (D.projeto.versao ? ' · v' + D.projeto.versao : '') + ' · ' + D.geradoEm;
document.title = D.projeto.nome + ' · Arquitetura';

// ---------- abas ----------
const abas = $('#abas');
D.paginas.forEach((p, i) => {
  const b = document.createElement('button');
  b.className = 'aba'; b.role = 'tab'; b.textContent = p.aba; b.title = p.titulo + ' (' + (i + 1) + ')';
  b.onclick = () => irPara(i);
  abas.appendChild(b);
});

// ---------- viewer do draw.io (modo sem SVG exportado) ----------
let viewerPronto = null;
function carregarViewer() {
  if (viewerPronto) return viewerPronto;
  viewerPronto = new Promise((ok, falha) => {
    const s = document.createElement('script');
    s.src = 'https://viewer.diagrams.net/js/viewer-static.min.js';
    s.onload = ok; s.onerror = () => falha(new Error('sem internet'));
    document.head.appendChild(s);
  });
  return viewerPronto;
}
const cacheViewer = new Map();
async function svgDoViewer(i) {
  // renderiza a página com o motor do draw.io e pede o mesmo SVG que o export geraria (com data-cell-id)
  if (cacheViewer.has(i)) return cacheViewer.get(i).cloneNode(true);
  await carregarViewer();
  const div = document.createElement('div');
  div.className = 'mxgraph';
  div.style.cssText = 'position:absolute;left:-99999px;top:0;width:800px;height:600px';
  div.setAttribute('data-mxgraph', JSON.stringify({ xml: D.xml, page: i, toolbar: '', nav: false }));
  document.body.appendChild(div);
  const v = await new Promise((ok) => window.GraphViewer.createViewerForElement(div, ok));
  const el = v.graph.getSvg(D.paleta.fundo, 1, 24);
  div.remove();
  cacheViewer.set(i, el);
  return el.cloneNode(true);
}

// ---------- montar página ----------
async function mostrar(i) {
  const p = D.paginas[i];
  palco.innerHTML = ''; pecas = new Map(); selecao = null;
  if (D.modo === 'svg') {
    palco.innerHTML = p.svg.replace(/data:x-ref,(\\d+)/g, (m, n) => D.uris[+n]);
    svg = palco.querySelector('svg');
  } else {
    try {
      $('#aviso').style.display = 'none';
      svg = await svgDoViewer(i);
      palco.appendChild(svg);
    } catch (e) {
      $('#aviso').style.display = 'flex';
      $('#aviso').textContent = 'Este HTML usa o visualizador do draw.io e precisa de internet. Abra o arquitetura.drawio no draw.io ou gere o HTML de novo depois de exportar as imagens.';
      return;
    }
  }
  const vb = (svg.getAttribute('viewBox') || '').split(/[\\s,]+/).map(Number);
  larg = vb[2] || svg.getBBox().width; alt = vb[3] || svg.getBBox().height;
  svg.setAttribute('width', larg); svg.setAttribute('height', alt);
  // o draw.io exporta cores com light-dark(): fixa o esquema claro para as cores serem exatamente as da imagem
  svg.style.colorScheme = 'only light';
  svg.style.background = D.paleta.fundo;
  decorar(p);
}

function decorar(p) {
  const pref = p.prefixo;
  svg.querySelectorAll('g[data-cell-id]').forEach((g) => {
    const cid = g.getAttribute('data-cell-id');
    if (!cid.startsWith(pref)) return;
    const k = cid.slice(pref.length);
    let tipo = null, ref = null;
    if (k.startsWith('e_') && p.arestas[k.slice(2)]) { tipo = 'aresta'; ref = k.slice(2); }
    else if (p.nos[k]) { tipo = 'no'; ref = k; }
    else if (p.grupos[k]) { tipo = 'grupo'; ref = k; }
    if (!tipo) return;
    g.dataset.ref = tipo + ':' + ref;
    g.classList.add('mx-' + tipo);
    if (tipo === 'aresta') {
      // área de clique generosa em volta da linha
      g.querySelectorAll('path').forEach((pt) => { if (pt.getAttribute('fill') && pt.getAttribute('fill') !== 'none') return; const c = pt.cloneNode(); c.removeAttribute('stroke-dasharray'); c.removeAttribute('style'); c.setAttribute('class', 'hit'); pt.parentNode.insertBefore(c, pt); });
      pecas.set(g.dataset.ref, [g]);
    } else if (tipo === 'grupo') {
      pecas.set(g.dataset.ref, [...g.children].filter(c => !c.hasAttribute('data-cell-id')));
    } else pecas.set(g.dataset.ref, [g]);
  });
}

// ---------- zoom e arrasto ----------
const aplicar = () => { palco.style.transform = 'translate(' + vis.x + 'px,' + vis.y + 'px) scale(' + vis.s + ')'; $('#pct').textContent = Math.round(vis.s * 100) + '%'; };
const limitar = (s) => Math.min(6, Math.max(0.08, s));
function ajustar() {
  const r = area.getBoundingClientRect(), m = 24;
  const s = limitar(Math.min((r.width - 2 * m) / larg, (r.height - 2 * m) / alt, 1.25));
  vis = { s, x: (r.width - larg * s) / 2, y: Math.max(m, (r.height - alt * s) / 2) }; aplicar();
}
function zoomEm(fator, cx, cy) {
  const r = area.getBoundingClientRect();
  if (cx == null) { cx = r.width / 2; cy = r.height / 2; }
  const s = limitar(vis.s * fator), k = s / vis.s;
  vis = { s, x: cx - (cx - vis.x) * k, y: cy - (cy - vis.y) * k }; aplicar();
}
// caixa real da peça: os rótulos HTML do draw.io (foreignObject 100%) inflam o getBBox do grupo inteiro
function caixa(el) {
  const forma = el.querySelector(':scope > g > rect, :scope > g > path, rect');
  if (forma && !el.classList.contains('mx-aresta')) return forma.getBBox();
  const ps = [...el.querySelectorAll('path:not(.hit)')].map(p => p.getBBox());
  if (!ps.length) return el.getBBox();
  const x1 = Math.min(...ps.map(q => q.x)), y1 = Math.min(...ps.map(q => q.y));
  return { x: x1, y: y1, width: Math.max(...ps.map(q => q.x + q.width)) - x1, height: Math.max(...ps.map(q => q.y + q.height)) - y1 };
}
function centrarEm(el) {
  if (!el || !el.getBBox) return;
  const b = caixa(el), r = area.getBoundingClientRect();
  const aberto = painel.classList.contains('aberto'), estreito = r.width <= 760;
  const livreX = aberto && !estreito ? r.width - 400 : r.width;
  const livreY = aberto && estreito ? Math.max(160, r.height - painel.getBoundingClientRect().height - 16) : r.height;
  if (vis.s < 0.55) vis.s = Math.min(0.9, limitar(Math.min(livreX / (b.width * 1.8), livreY / (b.height * 3))));
  vis.x = livreX / 2 - (b.x + b.width / 2) * vis.s; vis.y = livreY / 2 - (b.y + b.height / 2) * vis.s; aplicar();
}
area.addEventListener('wheel', (e) => { e.preventDefault(); const r = area.getBoundingClientRect(); zoomEm(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
const ponteiros = new Map(); let inicio = null, moveu = false, alvo = null, pinca = null;
area.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ponteiros.size === 2) { const [a, b] = [...ponteiros.values()]; pinca = { d: Math.hypot(a.x - b.x, a.y - b.y), s: vis.s }; moveu = true; return; }
  inicio = { x: e.clientX, y: e.clientY, vx: vis.x, vy: vis.y }; moveu = false;
  alvo = e.target.closest ? e.target.closest('[data-ref]') : null;
  area.setPointerCapture(e.pointerId);
});
area.addEventListener('pointermove', (e) => {
  if (!ponteiros.has(e.pointerId)) return;
  ponteiros.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinca && ponteiros.size === 2) { const [a, b] = [...ponteiros.values()]; const r = area.getBoundingClientRect(); zoomEm((pinca.s * Math.hypot(a.x - b.x, a.y - b.y) / pinca.d) / vis.s, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); return; }
  if (!inicio) return;
  const dx = e.clientX - inicio.x, dy = e.clientY - inicio.y;
  if (!moveu && Math.hypot(dx, dy) > 4) { moveu = true; area.classList.add('arrastando'); }
  if (moveu) { vis.x = inicio.vx + dx; vis.y = inicio.vy + dy; aplicar(); }
});
const soltar = (e) => {
  ponteiros.delete(e.pointerId); if (ponteiros.size < 2) pinca = null;
  if (!inicio) return;
  area.classList.remove('arrastando');
  if (!moveu) { if (alvo) selecionar(alvo.dataset.ref); else limpar(); }
  inicio = null; alvo = null;
};
area.addEventListener('pointerup', soltar); area.addEventListener('pointercancel', soltar);
area.addEventListener('dblclick', (e) => { if (!e.target.closest('[data-ref]')) ajustar(); });
$('#mais').onclick = () => zoomEm(1.25); $('#menos').onclick = () => zoomEm(0.8); $('#ajustar').onclick = ajustar;
$('#pct').onclick = () => zoomEm(1 / vis.s);
window.addEventListener('resize', () => { if (selecao && pecas.has(selecao)) centrarEm(pecas.get(selecao)[0]); else ajustar(); });

// ---------- seleção ----------
function destacar(manter, principal) {
  for (const [ref, els] of pecas) { const apaga = manter && !manter.has(ref); els.forEach(el => el.classList.toggle('apagado', apaga)); }
  svg.querySelectorAll('.sel').forEach(el => el.classList.remove('sel'));
  if (principal) (pecas.get(principal) || []).forEach(el => el.classList.add('sel'));
}
function selecionar(ref, { centrar = false } = {}) {
  const p = D.paginas[atual]; const [tipo, id] = ref.split(':');
  selecao = ref;
  const manter = new Set([ref]);
  if (tipo === 'no') { const n = p.nos[id]; for (const a of [...n.entrada, ...n.saida]) { manter.add('aresta:' + a); manter.add('no:' + p.arestas[a].de); manter.add('no:' + p.arestas[a].para); } }
  if (tipo === 'aresta') { const a = p.arestas[id]; manter.add('no:' + a.de); manter.add('no:' + a.para); }
  if (tipo === 'grupo') { const g = p.grupos[id]; for (const m of g.membros) manter.add('no:' + m); for (const [k, a] of Object.entries(p.arestas)) if (g.membros.includes(a.de) && g.membros.includes(a.para)) manter.add('aresta:' + k); for (const [k, x] of Object.entries(p.grupos)) if (x.membros.some(m => g.membros.includes(m))) manter.add('grupo:' + k); }
  destacar(manter, ref);
  abrirPainel(p, tipo, id);
  if (centrar) centrarEm((pecas.get(ref) || [])[0]);
  history.replaceState(null, '', '#v=' + encodeURIComponent(p.idPagina) + '&i=' + encodeURIComponent(ref));
}
function limpar() {
  selecao = null; destacar(null, null); painel.classList.remove('aberto');
  history.replaceState(null, '', '#v=' + encodeURIComponent(D.paginas[atual].idPagina));
}
$('#fechar').onclick = limpar;

// ---------- painel ----------
const botaoItem = (ref, titulo, sub) => '<button class="item" data-ir="' + h(ref) + '">' + titulo + (sub ? '<small>' + sub + '</small>' : '') + '</button>';
const modoTxt = (m) => m === 'assincrono' ? 'assíncrona' : 'síncrona';
const evid = (l) => l && l.length ? '<h3>Evidências no código</h3>' + l.map(e => '<span class="ev">' + h(e) + '</span>').join('') : '';
function outrasPaginas(idNo) {
  const l = D.paginas.map((q, i) => ({ q, i })).filter(({ q, i }) => i !== atual && q.nos[idNo]);
  return l.length ? '<h3>Aparece também em</h3><div class="pills">' + l.map(({ q, i }) => '<button class="pill item" style="width:auto;padding:3px 10px" data-pagina="' + i + '" data-alvo="no:' + h(idNo) + '">' + h(q.aba) + '</button>').join('') + '</div>' : '';
}
function abrirPainel(p, tipo, id) {
  let chip = '', tit = '', html = '';
  if (tipo === 'no') {
    const n = p.nos[id];
    chip = '<i style="border-color:' + n.cor + '"></i>' + h(n.tipo) + ' · ' + h(n.camadaRotulo) + (n.vizinho ? ' · fora deste container' : '');
    tit = h(n.nome);
    html += n.descricao ? '<p class="desc">' + h(n.descricao) + '</p>' : '';
    if (n.pai) html += '<p class="vazio">Parte de: ' + h(n.pai) + '</p>';
    if (n.tecs.length) html += '<h3>Tecnologias</h3><div class="pills">' + n.tecs.map(t => '<span class="pill">' + h(t) + '</span>').join('') + '</div>';
    if (n.internos) html += '<h3>Partes internas</h3><div class="pills">' + n.internos.map(t => '<span class="pill">' + h(t) + '</span>').join('') + '</div>';
    const lista = (ids, sentido) => ids.map(a => { const x = p.arestas[a]; const outro = p.nos[sentido === 'sai' ? x.para : x.de]; return botaoItem('aresta:' + a, (x.numero ? '' : (sentido === 'sai' ? '→ ' : '← ')) + '<b>' + h(outro ? outro.nome : '?') + '</b><span class="modo">' + modoTxt(x.modo) + '</span>', h(x.rotulo).replace(/\\n/g, '<br>')); }).join('');
    if (n.saida.length) html += '<h3>Chama / envia para</h3><div class="lista">' + lista(n.saida, 'sai') + '</div>';
    if (n.entrada.length) html += '<h3>Recebe de</h3><div class="lista">' + lista(n.entrada, 'entra') + '</div>';
    if (!n.saida.length && !n.entrada.length) html += '<p class="vazio">Sem conexões nesta visão.</p>';
    html += evid(n.evidencias) + outrasPaginas(id);
  } else if (tipo === 'aresta') {
    const a = p.arestas[id], de = p.nos[a.de], para = p.nos[a.para];
    chip = (a.numero ? 'Passo ' + a.numero + ' · ' : '') + 'Conexão ' + modoTxt(a.modo);
    tit = h(de ? de.nome : a.de) + ' → ' + h(para ? para.nome : a.para);
    html += '<p class="desc"><code>' + h(a.rotulo).replace(/\\n/g, '<br>') + '</code></p>';
    html += '<p class="vazio">' + (a.modo === 'assincrono' ? 'Linha tracejada: quem inicia não espera a resposta (webhook, fila, evento, cron).' : 'Linha sólida: quem inicia espera a resposta.') + ' A seta parte de quem inicia.</p>';
    if (a.itens.length > 1) html += '<h3>' + a.itens.length + ' interações agrupadas nesta seta</h3>';
    html += a.itens.map(x => '<div class="passo"><b>' + h([x.protocolo, x.acao].filter(Boolean).join(' · ')) + '</b><span class="modo">' + modoTxt(x.modo) + '</span>' + (a.itens.length > 1 || x.de !== (de && de.nome) ? '<br><small class="vazio">' + h(x.de) + ' → ' + h(x.para) + '</small>' : '') + (x.descricao ? '<div>' + h(x.descricao) + '</div>' : '') + (x.evidencias.length ? '<div style="margin-top:4px">' + x.evidencias.map(e => '<span class="ev">' + h(e) + '</span>').join('') + '</div>' : '') + '</div>').join('');
    html += '<h3>Pontas</h3><div class="lista">' + botaoItem('no:' + a.de, '<b>' + h(de ? de.nome : a.de) + '</b>', 'origem · ' + h(de ? de.tipo : '')) + botaoItem('no:' + a.para, '<b>' + h(para ? para.nome : a.para) + '</b>', 'destino · ' + h(para ? para.tipo : '')) + '</div>';
  } else {
    const g = p.grupos[id];
    chip = g.container ? 'Container' : 'Onde roda · ' + h(g.tipo);
    tit = h(g.nome);
    if (g.descricao) html += '<p class="desc">' + h(g.descricao) + '</p>';
    if (g.tecs && g.tecs.length) html += '<h3>Tecnologias</h3><div class="pills">' + g.tecs.map(t => '<span class="pill">' + h(t) + '</span>').join('') + '</div>';
    html += '<h3>' + (g.container ? 'Componentes' : 'Roda aqui') + '</h3><div class="lista">' + (g.membros.map(m => botaoItem('no:' + m, '<b>' + h(p.nos[m].nome) + '</b>', h(p.nos[m].tipo))).join('') || '<p class="vazio">Só grupos internos.</p>') + '</div>';
  }
  $('#pchip').innerHTML = chip; $('#ptit').innerHTML = tit; corpo.innerHTML = html; corpo.scrollTop = 0;
  painel.classList.add('aberto');
}
corpo.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ir],[data-pagina]'); if (!b) return;
  if (b.dataset.pagina) irPara(+b.dataset.pagina, b.dataset.alvo);
  else selecionar(b.dataset.ir, { centrar: true });
});

// ---------- busca ----------
const indice = [];
D.paginas.forEach((p, i) => { for (const n of Object.values(p.nos)) indice.push({ i, ref: 'no:' + n.id, nome: n.nome, extra: n.tipo + (n.tecs.length ? ' · ' + n.tecs.join(', ') : ''), alvo: (n.nome + ' ' + n.tecs.join(' ') + ' ' + n.descricao).toLowerCase() }); });
const q = $('#q'), res = $('#resultados'); let achados = [], ativo = 0;
const norm = (s) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
function buscar() {
  const t = norm(q.value.trim()); if (!t) { res.classList.remove('aberto'); return; }
  const vistos = new Set();
  achados = indice.filter(x => norm(x.alvo).includes(t)).sort((a, b) => (norm(a.nome).startsWith(t) ? 0 : 1) - (norm(b.nome).startsWith(t) ? 0 : 1) || (a.i === atual ? -1 : b.i === atual ? 1 : a.i - b.i))
    .filter(x => { const k = x.ref + '@' + x.i; if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, 30);
  ativo = 0;
  res.innerHTML = achados.length ? achados.map((x, k) => '<button class="res' + (k === 0 ? ' ativo' : '') + '" data-k="' + k + '"><b>' + h(x.nome) + '</b><small>' + h(D.paginas[x.i].aba) + ' · ' + h(x.extra) + '</small></button>').join('') : '<div class="res vazio">Nada encontrado</div>';
  res.classList.add('aberto');
}
function escolher(k) { const x = achados[k]; if (!x) return; res.classList.remove('aberto'); q.blur(); irPara(x.i, x.ref); }
q.addEventListener('input', buscar);
q.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ativo = Math.max(0, Math.min(achados.length - 1, ativo + (e.key === 'ArrowDown' ? 1 : -1))); res.querySelectorAll('.res').forEach((b, k) => b.classList.toggle('ativo', k === ativo)); }
  if (e.key === 'Enter') escolher(ativo);
  if (e.key === 'Escape') { q.value = ''; res.classList.remove('aberto'); q.blur(); }
});
res.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) escolher(+b.dataset.k); });
document.addEventListener('click', (e) => { if (!e.target.closest('#busca')) res.classList.remove('aberto'); });

// ---------- navegação ----------
async function irPara(i, ref) {
  if (i !== atual) {
    atual = i;
    abas.querySelectorAll('.aba').forEach((b, k) => b.setAttribute('aria-selected', k === i));
    abas.children[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    painel.classList.remove('aberto');
    await mostrar(i); ajustar();
  }
  if (ref && pecas.has(ref)) selecionar(ref, { centrar: true });
  else history.replaceState(null, '', '#v=' + encodeURIComponent(D.paginas[i].idPagina));
}
document.addEventListener('keydown', (e) => {
  if (e.target === q) return;
  if (e.key === '/') { e.preventDefault(); q.focus(); }
  else if (e.key === 'Escape') limpar();
  else if (e.key === '0') ajustar();
  else if (e.key === '+' || e.key === '=') zoomEm(1.25);
  else if (e.key === '-') zoomEm(0.8);
  else if (/^[1-9]$/.test(e.key) && D.paginas[+e.key - 1]) irPara(+e.key - 1);
});
const hash = new URLSearchParams(location.hash.slice(1));
const ini = Math.max(0, D.paginas.findIndex(p => p.idPagina === hash.get('v')));
irPara(ini, hash.get('i') || undefined);
})();
</script>
</body>
</html>
`;

fs.writeFileSync(arqSaida, html);
const kb = Math.round(fs.statSync(arqSaida).size / 1024);
console.log(`[html] ${arqSaida} (${kb} KB, ${dados.paginas.length} página(s), modo ${modo}${modo === 'viewer' ? ': precisa de internet para abrir; exporte as imagens e gere de novo para ter a versão offline' : ''})`);
