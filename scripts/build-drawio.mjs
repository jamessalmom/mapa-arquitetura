#!/usr/bin/env node
// Gera o .drawio (uma página por visão) a partir do mapa JSON, com layout automático (ELK.js),
// logos embutidos, setas com protocolo · ação, legenda e cabeçalho.
// Uso: node build-drawio.mjs <mapa.json> <saida.drawio> [--preservar <anterior.drawio>] [--mermaid <saida.mmd>]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregarDep } from './_deps.mjs';
import { carregarMapa, derivarVisao, mascarador, paleta, TIPO_ROTULO, CAMADA_ROTULO, ehInterno } from './_mapa.mjs';
import { resolverIcone, nomeTec } from './icons.mjs';

const args = process.argv.slice(2);
const [arqMapa, arqSaida] = args.filter((a, i) => !a.startsWith('--') && !['--preservar', '--mermaid'].includes(args[i - 1]));
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
if (!arqMapa || !arqSaida) { console.error('Uso: node build-drawio.mjs <mapa.json> <saida.drawio> [--preservar anterior.drawio] [--mermaid saida.mmd]'); process.exit(1); }

const ELK = await carregarDep('elkjs/lib/elk.bundled.js');
const elk = new ELK();
const mapa = carregarMapa(arqMapa);
const mask = mascarador(mapa);
const escuro = mapa.projeto.tema === 'escuro';
const hoje = new Date().toISOString().slice(0, 10);

// ---------------- paleta ----------------
const PAL = paleta(escuro);

// ---------------- util ----------------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\n/g, '&#10;');
const html = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const larguraTexto = (s, px = 6.3) => Math.max(...String(s).split('\n').map(l => l.length)) * px;
const W = 250, W_SIS = 320, ICON = 44, MINI = 20;
const id = (v, x) => `${v.replace(/[^\w]/g, '_')}__${x}`;

function alturaNo(n) {
  const desc = mask(n.descricao || '');
  const charsLinha = n.tipo === 'sistema' ? 40 : 30;
  const linhasDesc = desc ? Math.min(4, Math.ceil(desc.length / charsLinha)) : 0;
  const linhasNome = Math.ceil(n.nome.length / (n.tipo === 'sistema' ? 26 : 22));
  return Math.max(n.tipo === 'sistema' ? 120 : 92, 22 + linhasNome * 17 + 16 + linhasDesc * 13 + 14);
}

// ---------------- preservação de layout ----------------
async function lerAnterior(arq) {
  if (!arq || !fs.existsSync(arq)) return null;
  const { XMLParser } = await carregarDep('fast-xml-parser');
  const zlib = await import('node:zlib');
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => ['diagram', 'mxCell', 'mxPoint'].includes(n) });
  const bruto = fs.readFileSync(arq, 'utf8');
  const doc = p.parse(bruto);
  const geo = new Map();
  const paginas = new Map([...bruto.matchAll(/<diagram\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/diagram>/g)].map(m => [m[1], m[0]]));
  for (const d of doc.mxfile?.diagram || []) {
    let model = d.mxGraphModel;
    if (!model && typeof d['#text'] === 'string') { // diagrama comprimido (deflate + base64)
      const xml = decodeURIComponent(zlib.inflateRawSync(Buffer.from(d['#text'], 'base64')).toString());
      model = p.parse(xml).mxGraphModel;
    }
    for (const c of model?.root?.mxCell || []) {
      if (c.vertex === '1' && c.mxGeometry) geo.set(c.id, { x: +c.mxGeometry.x || 0, y: +c.mxGeometry.y || 0, w: +c.mxGeometry.width, h: +c.mxGeometry.height, parent: c.parent });
    }
  }
  return { geo, paginas, has: (k) => geo.has(k) };
}
const anterior = await lerAnterior(opt('--preservar'));

// ---------------- construção de uma página ----------------
const relatorio = { paginas: [], semIcone: [], icones: {}, direcoes: {} };
const arqRelatorio = path.join(path.dirname(path.resolve(arqSaida)), '.trabalho', 'build-relatorio.json');
const relAnterior = fs.existsSync(arqRelatorio) ? (() => { try { return JSON.parse(fs.readFileSync(arqRelatorio, 'utf8')); } catch { return null; } })() : null;

async function iconesDe(n) {
  const out = [];
  if (n.icone) out.push(await resolverIcone(n.icone));
  for (const t of n.tecnologias) { const r = await resolverIcone(t); relatorio.icones[t] = r.fonte; out.push({ ...r, chave: t }); }
  return out;
}

async function pagina(visao) {
  const v = derivarVisao(mapa, visao);
  const cells = [];
  const P = id(visao, '');
  // assinatura do conteúdo da página: se nada mudou desde a geração anterior, a página antiga é mantida
  // INTEIRA (com todos os ajustes manuais feitos no draw.io)
  const assinatura = crypto.createHash('sha1').update(JSON.stringify({
    t: mapa.projeto.tema, mk: mapa.projeto.mascararHosts, nome: mapa.projeto.nome, d: mapa.projeto.direcao,
    n: v.nos.map(n => [n.id, n.nome, n.tipo, n.camada, n.tecnologias, n.descricao, n.grupo, n.icone, n._vizinho]),
    g: v.grupos.map(g => [g.id, g.nome, g.tipo, g.pai]), c: v.conexoes.map(c => [c.de, c.para, c.rotulo ?? [c.protocolo, c.acao].join(' · '), c.modo])
  })).digest('hex').slice(0, 16);
  const idPagina = P.replace(/_+$/, '');
  const antes = relAnterior?.paginas?.find(p => p.visao === visao);
  if (anterior && antes?.assinatura === assinatura && anterior.paginas.has(idPagina)) {
    relatorio.paginas.push({ ...antes, preservado: true });
    relatorio.direcoes[visao] = relAnterior.direcoes?.[visao];
    return anterior.paginas.get(idPagina);
  }
  const OX = 40, OY = 120;

  // ---- grafo ELK ----
  const elkNos = new Map();
  const raiz = { id: 'root', layoutOptions: {
    'elk.algorithm': 'layered', 'elk.direction': mapa.projeto.direcao || 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.json.edgeCoords': 'ROOT', 'elk.json.shapeCoords': 'PARENT',
    'elk.spacing.nodeNode': '50', 'elk.layered.spacing.nodeNodeBetweenLayers': '60', 'elk.layered.spacing.edgeNodeBetweenLayers': '18',
    'elk.spacing.edgeEdge': '16', 'elk.layered.spacing.edgeEdgeBetweenLayers': '16', 'elk.spacing.edgeLabel': '6',
    'elk.edgeLabels.placement': 'CENTER', 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES', 'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
    'elk.portConstraints': 'FREE', 'elk.layered.mergeEdges': 'false', 'elk.layered.thoroughness': '20' }, children: [], edges: [] };
  const ordemCamada = { pessoa: 0, cliente: 1, infra: 2, sistema: 3, aplicacao: 3, mensageria: 4, dados: 5, externo: 6 };
  const grupos = new Map(v.grupos.map(g => [g.id, { id: g.id, layoutOptions: { 'elk.padding': '[top=44,left=24,bottom=24,right=24]' }, children: [], _g: g }]));
  for (const g of grupos.values()) (g._g.pai && grupos.get(g._g.pai) ? grupos.get(g._g.pai).children : raiz.children).push(g);
  // fluxo: ordem de aparição nos passos; demais visões: ordem por camada (pessoas à esquerda, externos à direita)
  const nosOrd = v.numerada ? [...v.nos] : [...v.nos].sort((a, b) => (ordemCamada[a.camada] ?? 3) - (ordemCamada[b.camada] ?? 3));
  for (const n of nosOrd) {
    const e = { id: n.id, width: n.tipo === 'sistema' ? W_SIS : W, height: alturaNo(n), _n: n };
    elkNos.set(n.id, e);
    (n.grupo && grupos.get(n.grupo) ? grupos.get(n.grupo).children : raiz.children).push(e);
  }
  for (const c of v.conexoes) {
    if (!elkNos.has(c.de) && !grupos.has(c.de)) throw new Error(`[${visao}] conexão ${c.id}: origem "${c.de}" não está na visão`);
    if (!elkNos.has(c.para) && !grupos.has(c.para)) throw new Error(`[${visao}] conexão ${c.id}: destino "${c.para}" não está na visão`);
    const rot = mask(c.rotulo ?? [c.protocolo, c.acao].filter(Boolean).join(' · '));
    raiz.edges.push({ id: c.id, sources: [c.de], targets: [c.para], labels: rot ? [{ text: rot, width: larguraTexto(rot) + 14, height: 18 * rot.split('\n').length + 2 }] : [], _c: { ...c, rotulo: rot } });
  }
  // ---- modo atualização: marca como NOVO o que não existia na geração anterior ----
  const novos = new Set();
  if (anterior && [...elkNos.keys()].some(k => anterior.has(id(visao, k))))
    for (const k of elkNos.keys()) if (!anterior.has(id(visao, k))) novos.add(k);
  const preservado = false;

  const layout = (grafo) => elk.layout(structuredClone(grafo));
  let res, direcao = mapa.projeto.direcao || (anterior && relAnterior?.direcoes?.[visao]);
  if (direcao) { raiz.layoutOptions['elk.direction'] = direcao; res = await layout(raiz); }
  else {
    const opcoes = [];
    for (const d of ['RIGHT', 'DOWN']) {
      const g = structuredClone(raiz); g.layoutOptions['elk.direction'] = d;
      const out = await layout(g);
      opcoes.push({ out, d, nota: Math.abs(Math.log(out.width / out.height) - Math.log(1.6)) });
    }
    const [dir, baixo] = opcoes;
    const usarBaixo = dir.out.width / dir.out.height > 3.6 && baixo.nota < dir.nota - 0.6;
    res = usarBaixo ? baixo.out : dir.out; direcao = usarBaixo ? 'DOWN' : 'RIGHT';
  }
  relatorio.direcoes[visao] = direcao;

  // ---- posições absolutas ----
  const abs = new Map();
  const percorrer = (no, ox, oy, parentCell) => {
    for (const ch of no.children || []) {
      const x = ox + ch.x, y = oy + ch.y;
      abs.set(ch.id, { x, y, w: ch.width, h: ch.height, rel: { x: ch.x, y: ch.y }, parentCell, grupo: !!grupos.get(ch.id) });
      if (ch.children?.length) percorrer(ch, x, y, id(visao, ch.id));
    }
  };
  percorrer(res, 0, 0, '1');

  // ---- células: grupos ----
  const grupoIds = [...grupos.keys()];
  for (const gid of grupoIds) {
    const g = grupos.get(gid)._g; const a = abs.get(gid);
    const rotulo = g._container
      ? `<b>${html(g.nome)}</b> <span style="color:${PAL.textoSec};font-size:11px">[${html(g.tipo)}${g.tecnologias?.length ? ': ' + html(g.tecnologias.map(nomeTec).join(', ')) : ''}]</span>`
      : `<b>${html(g.nome)}</b> <span style="color:${PAL.textoSec};font-size:11px">[${html(g.tipo || 'grupo')}]</span>`;
    const x = a.parentCell === '1' ? a.rel.x + OX : a.rel.x, y = a.parentCell === '1' ? a.rel.y + OY : a.rel.y;
    cells.push(`<mxCell id="${id(visao, gid)}" value="${esc(rotulo)}" style="rounded=1;arcSize=3;dashed=1;dashPattern=8 4;fillColor=none;strokeColor=${PAL.grupo};strokeWidth=1.5;verticalAlign=top;align=left;spacingLeft=12;spacingTop=6;fontSize=13;fontColor=${PAL.texto};html=1;whiteSpace=wrap;container=1;collapsible=0;recursiveResize=0;" vertex="1" parent="${a.parentCell}"><mxGeometry x="${r(x)}" y="${r(y)}" width="${r(a.w)}" height="${r(a.h)}" as="geometry"/></mxCell>`);
  }

  // ---- células: nós ----
  const camadasUsadas = new Set();
  for (const n of v.nos) {
    const a = abs.get(n.id); const cid = id(visao, n.id);
    const [fill, stroke] = PAL.camada[n.camada] || PAL.camada.aplicacao;
    camadasUsadas.add(n.camada);
    const sis = n.tipo === 'sistema';
    const txt = sis ? '#FFFFFF' : PAL.texto, sec = sis ? '#DBEAFE' : PAL.textoSec;
    const icones = n.tipo === 'pessoa' ? [] : await iconesDe(n);
    const tecs = n.tecnologias.map(nomeTec).filter(t => t.toLowerCase() !== n.nome.toLowerCase()).join(', ');
    const tipoRot = TIPO_ROTULO[n.tipo] || n.tipo;
    const label = `<div style="text-align:left;line-height:1.25"><b style="font-size:${sis ? 16 : 13}px">${html(n.nome)}</b>` +
      `<div style="font-size:10px;color:${sec};margin-top:2px">[${html(tipoRot)}${tecs ? ': ' + html(tecs) : ''}]${n._vizinho ? ' · fora deste container' : ''}${novos.has(n.id) ? ' · <b style="color:#DC2626">NOVO</b>' : ''}</div>` +
      (n.descricao ? `<div style="font-size:10.5px;margin-top:5px">${html(mask(n.descricao))}</div>` : '') + `</div>`;
    const x = a.parentCell === '1' ? a.rel.x + OX : a.rel.x, y = a.parentCell === '1' ? a.rel.y + OY : a.rel.y;
    const tracejado = n._vizinho || n.camada === 'externo' ? 'dashed=1;dashPattern=4 3;' : '';
    cells.push(`<mxCell id="${cid}" value="${esc(label)}" style="rounded=1;arcSize=6;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};strokeWidth=${sis ? 2 : 1.5};${tracejado}align=left;verticalAlign=middle;spacingLeft=${ICON + 22};spacingRight=10;spacingTop=4;spacingBottom=4;fontColor=${txt};fontSize=12;" vertex="1" parent="${a.parentCell}"><mxGeometry x="${r(x)}" y="${r(y)}" width="${r(a.w)}" height="${r(a.h)}" as="geometry"/></mxCell>`);

    // ícones dentro do nó (filhos da célula: movem junto)
    const yIco = Math.max(10, (a.h - ICON) / 2 - (icones.length > 1 ? 12 : 0));
    if (n.tipo === 'pessoa') {
      cells.push(`<mxCell id="${cid}__ico0" value="" style="shape=actor;html=1;fillColor=${stroke};strokeColor=none;" vertex="1" parent="${cid}"><mxGeometry x="16" y="${r((a.h - 40) / 2)}" width="34" height="40" as="geometry"/></mxCell>`);
    } else if (!icones.length) {
      cells.push(badge(`${cid}__ico0`, cid, n.nome, 12, yIco, ICON, stroke));
      relatorio.semIcone.push(`${visao}: ${n.id} (sem tecnologia declarada)`);
    } else {
      icones.slice(0, 3).forEach((ic, i) => {
        const tam = i === 0 ? ICON : MINI;
        const x0 = i === 0 ? 12 : 12 + (i - 1) * (MINI + 4), y0 = i === 0 ? yIco : yIco + ICON + 4;
        const icid = `${cid}__ico${i}`;
        // tema escuro: placa clara atrás do logo (logos pretos/escuros somem no fundo escuro)
        if (escuro && ic.tipo !== 'badge') { const pad = i === 0 ? 5 : 2; cells.push(`<mxCell id="${icid}_placa" value="" style="rounded=1;arcSize=24;html=1;fillColor=#F8FAFC;strokeColor=none;" vertex="1" parent="${cid}"><mxGeometry x="${x0 - pad}" y="${r(y0 - pad)}" width="${tam + 2 * pad}" height="${tam + 2 * pad}" as="geometry"/></mxCell>`); }
        if (ic.tipo === 'drawio') cells.push(`<mxCell id="${icid}" value="" style="${ic.style}" vertex="1" parent="${cid}"><mxGeometry x="${x0}" y="${r(y0)}" width="${tam}" height="${tam}" as="geometry"/></mxCell>`);
        else if (ic.tipo === 'imagem') cells.push(`<mxCell id="${icid}" value="" style="shape=image;html=1;verticalLabelPosition=bottom;verticalAlign=top;imageAspect=1;aspect=fixed;image=${ic.dataUri};" vertex="1" parent="${cid}"><mxGeometry x="${x0}" y="${r(y0)}" width="${tam}" height="${tam}" as="geometry"/></mxCell>`);
        else { cells.push(badge(icid, cid, ic.texto || nomeTec(ic.chave), x0, y0, tam, stroke)); if (i === 0) relatorio.semIcone.push(`${visao}: ${n.id} → badge "${ic.texto}"`); }
      });
    }
  }

  // ---- células: arestas ----
  const rotulosColocados = [];
  const polilinhas = new Map((res.edges || []).filter(e => e.sections?.[0]).map(e => [e.id, [e.sections[0].startPoint, ...(e.sections[0].bendPoints || []), e.sections[0].endPoint]]));
  for (const e of res.edges) {
    const c = e._c || v.conexoes.find(x => x.id === e.id);
    const sec = e.sections?.[0];
    const async = c.modo === 'assincrono';
    const estilo = `edgeStyle=none;rounded=1;arcSize=12;html=1;endArrow=block;endFill=1;endSize=7;strokeWidth=1.6;strokeColor=${PAL.seta};${async ? 'dashed=1;dashPattern=7 5;' : ''}fontSize=10.5;fontColor=${PAL.texto};labelBackgroundColor=${PAL.fundo};align=center;verticalAlign=middle;`;
    let ancora = '', pontos = '', labelGeo = '';
    if (sec) {
      const s = abs.get(c.de), t = abs.get(c.para);
      const fr = (p, base, tam) => Math.round(Math.min(1, Math.max(0, (p - base) / tam)) * 10000) / 10000;
      ancora = `exitX=${fr(sec.startPoint.x, s.x, s.w)};exitY=${fr(sec.startPoint.y, s.y, s.h)};exitPerimeter=0;` +
        `entryX=${fr(sec.endPoint.x, t.x, t.w)};entryY=${fr(sec.endPoint.y, t.y, t.h)};entryPerimeter=0;`;
      const pts = (sec.bendPoints || []).map(p => `<mxPoint x="${r(p.x + OX)}" y="${r(p.y + OY)}"/>`).join('');
      pontos = pts ? `<Array as="points">${pts}</Array>` : '';
      const lb = e.labels?.[0];
      if (lb) {
        // rótulo SOBRE a seta (com fundo), no meio do maior trecho reto: fica inequívoco a qual seta pertence
        const poli = [sec.startPoint, ...(sec.bendPoints || []), sec.endPoint];
        const meio = pontoMedio(poli);
        // candidatos: 1/2, 1/3 e 2/3 de cada trecho, do maior trecho para o menor; fica com o primeiro
        // que não cobre nenhum card nem outro rótulo já colocado
        const lw = lb.width, lh = lb.height;
        const cands = [];
        for (let i = 1; i < poli.length; i++) {
          const a = poli[i - 1], b = poli[i]; const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d < 24) continue;
          for (const t of [0.5, 0.33, 0.67, 0.2, 0.8]) cands.push({ d, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        }
        cands.sort((p, q) => q.d - p.d);
        // pontuação de colisão: card pesa mais que outro rótulo, que pesa mais que cruzar outra seta
        const bate = (cx, cy) => {
          const R = { x1: cx - lw / 2, y1: cy - lh / 2, x2: cx + lw / 2, y2: cy + lh / 2 };
          const sobre = (o) => R.x1 < o.x2 && R.x2 > o.x1 && R.y1 < o.y2 && R.y2 > o.y1;
          let n = 0;
          for (const a of abs.values()) if (!a.grupo && sobre({ x1: a.x - 4, y1: a.y - 4, x2: a.x + a.w + 4, y2: a.y + a.h + 4 })) n += 100;
          n += 10 * rotulosColocados.filter(sobre).length;
          for (const [eid, pl] of polilinhas) { if (eid === e.id) continue;
            for (let i = 1; i < pl.length; i++) if (sobre({ x1: Math.min(pl[i].x, pl[i - 1].x) - 1, y1: Math.min(pl[i].y, pl[i - 1].y) - 1, x2: Math.max(pl[i].x, pl[i - 1].x) + 1, y2: Math.max(pl[i].y, pl[i - 1].y) + 1 })) n += 1; }
          return n;
        };
        let melhor = { x: meio.x, y: meio.y }, menor = Infinity;
        for (const p of cands) { const n = bate(p.x, p.y); if (n < menor) { menor = n; melhor = p; } if (n === 0) break; }
        rotulosColocados.push({ x1: melhor.x - lw / 2, y1: melhor.y - lh / 2, x2: melhor.x + lw / 2, y2: melhor.y + lh / 2 });
        labelGeo = `<mxPoint x="${r(melhor.x - meio.x)}" y="${r(melhor.y - meio.y)}" as="offset"/>`;
      }
    }
    cells.push(`<mxCell id="${id(visao, 'e_' + e.id)}" value="${esc(c.rotulo || '')}" style="${estilo}${ancora}" edge="1" parent="1" source="${id(visao, c.de)}" target="${id(visao, c.para)}"><mxGeometry relative="1" as="geometry">${labelGeo}${pontos}</mxGeometry></mxCell>`);
  }

  // ---- cabeçalho + legenda ----
  const caixas = [...abs.values()].filter(a => a.parentCell === '1');
  const maxX = Math.max(...caixas.map(a => a.rel.x + a.w)) + OX, maxY = Math.max(...caixas.map(a => a.rel.y + a.h)) + OY;
  const titulo = `<div style="text-align:left"><span style="font-size:22px;font-weight:bold">${html(mapa.projeto.nome)}</span>` +
    `<span style="font-size:22px;color:${PAL.textoSec}">  ·  ${html(v.titulo)}</span>` +
    `<div style="font-size:12px;color:${PAL.textoSec};margin-top:4px">${html(v.subtitulo)}  —  gerado em ${hoje}${mapa.projeto.versao ? '  ·  v' + html(mapa.projeto.versao) : ''}</div></div>`;
  cells.push(`<mxCell id="${P}titulo" value="${esc(titulo)}" style="text;html=1;align=left;verticalAlign=top;whiteSpace=wrap;fontColor=${PAL.texto};" vertex="1" parent="1"><mxGeometry x="${OX}" y="24" width="${Math.max(700, maxX - OX)}" height="60" as="geometry"/></mxCell>`);
  cells.push(`<mxCell id="${P}linha" value="" style="line;strokeWidth=1;strokeColor=${PAL.grupo};html=1;" vertex="1" parent="1"><mxGeometry x="${OX}" y="88" width="${Math.max(700, maxX - OX + 280)}" height="4" as="geometry"/></mxCell>`);
  cells.push(...legenda(P, maxX + 70, OY, camadasUsadas, v));

  relatorio.paginas.push({ visao, titulo: v.titulo, nos: v.nos.length, conexoes: v.conexoes.length, assinatura, preservado, largura: r(maxX + 330), altura: r(Math.max(maxY, OY + 330)) });
  const nomeAba = v.titulo.replace(/^Visão de /, '').replace(/^./, c => c.toUpperCase());
  return `<diagram name="${esc(nomeAba)}" id="${esc(P.replace(/_+$/, ''))}"><mxGraphModel dx="1200" dy="800" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" pageWidth="1600" pageHeight="900" background="${PAL.fundo}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join('')}</root></mxGraphModel></diagram>`;
}

function badge(cid, parent, texto, x, y, tam, cor) {
  const ini = String(texto || '?').replace(/\(.*?\)/g, '').trim().split(/[\s.\-/]+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
  return `<mxCell id="${cid}" value="${esc(ini)}" style="rounded=1;arcSize=22;html=1;fillColor=${cor};strokeColor=none;fontColor=#FFFFFF;fontStyle=1;fontSize=${tam > 30 ? 15 : 9};align=center;verticalAlign=middle;" vertex="1" parent="${parent}"><mxGeometry x="${x}" y="${r(y)}" width="${tam}" height="${tam}" as="geometry"/></mxCell>`;
}

function legenda(P, x, y, camadas, v) {
  const out = []; const lid = `${P}legenda`;
  const itens = [...camadas].filter(c => c !== 'pessoa');
  const h = 38 + itens.length * 26 + 3 * 26 + (v.numerada ? 26 : 0) + 8;
  out.push(`<mxCell id="${lid}" value="&lt;b&gt;Legenda&lt;/b&gt;" style="rounded=1;arcSize=4;html=1;fillColor=${escuro ? '#111827' : '#F9FAFB'};strokeColor=${PAL.grupo};verticalAlign=top;align=left;spacingLeft=12;spacingTop=8;fontSize=13;fontColor=${PAL.texto};container=1;collapsible=0;" vertex="1" parent="1"><mxGeometry x="${r(x)}" y="${y}" width="250" height="${h}" as="geometry"/></mxCell>`);
  let yy = 38;
  for (const c of itens) {
    const [f, s] = PAL.camada[c];
    out.push(`<mxCell id="${lid}_c_${c}" value="" style="rounded=1;arcSize=20;html=1;fillColor=${f};strokeColor=${s};strokeWidth=1.5;${c === 'externo' ? 'dashed=1;dashPattern=4 3;' : ''}" vertex="1" parent="${lid}"><mxGeometry x="12" y="${yy}" width="26" height="16" as="geometry"/></mxCell>`);
    out.push(`<mxCell id="${lid}_t_${c}" value="${esc(CAMADA_ROTULO[c] || c)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=${PAL.texto};" vertex="1" parent="${lid}"><mxGeometry x="46" y="${yy - 4}" width="180" height="24" as="geometry"/></mxCell>`);
    yy += 26;
  }
  const linha = (k, txt, dash) => {
    out.push(`<mxCell id="${lid}_l_${k}" value="" style="html=1;endArrow=block;endFill=1;endSize=6;strokeWidth=1.6;strokeColor=${PAL.seta};${dash ? 'dashed=1;dashPattern=7 5;' : ''}" edge="1" parent="${lid}"><mxGeometry relative="1" as="geometry"><mxPoint x="12" y="${yy + 8}" as="sourcePoint"/><mxPoint x="56" y="${yy + 8}" as="targetPoint"/></mxGeometry></mxCell>`);
    out.push(`<mxCell id="${lid}_lt_${k}" value="${esc(txt)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=${PAL.texto};" vertex="1" parent="${lid}"><mxGeometry x="64" y="${yy - 4}" width="180" height="24" as="geometry"/></mxCell>`);
    yy += 26;
  };
  linha('s', 'Síncrona (HTTP, SQL, gRPC)', false);
  linha('a', 'Assíncrona (webhook, fila, evento)', true);
  out.push(`<mxCell id="${lid}_rot" value="${esc('Rótulo: protocolo · ação')}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontStyle=2;fontColor=${PAL.textoSec};" vertex="1" parent="${lid}"><mxGeometry x="12" y="${yy - 4}" width="210" height="24" as="geometry"/></mxCell>`);
  yy += 26;
  if (v.numerada) out.push(`<mxCell id="${lid}_num" value="${esc('① ② ③ = ordem dos passos')}" style="text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=${PAL.texto};" vertex="1" parent="${lid}"><mxGeometry x="12" y="${yy - 4}" width="210" height="24" as="geometry"/></mxCell>`);
  return out;
}

function pontoMedio(pts) {
  const seg = []; let tot = 0;
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); seg.push(d); tot += d; }
  let alvo = tot / 2;
  for (let i = 1; i < pts.length; i++) {
    if (alvo <= seg[i - 1] || i === pts.length - 1) { const t = seg[i - 1] ? alvo / seg[i - 1] : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t }; }
    alvo -= seg[i - 1];
  }
  return pts[0];
}
function r(n) { return Math.round(n * 10) / 10; }

// ---------------- Mermaid (visão de containers, sem ícones) ----------------
function mermaid() {
  const v = derivarVisao(mapa, 'containers');
  const sid = (s) => s.replace(/[^\w]/g, '_');
  const linhas = ['flowchart LR'];
  const porGrupo = new Map();
  for (const n of v.nos) { const k = n.grupo || ''; (porGrupo.get(k) || porGrupo.set(k, []).get(k)).push(n); }
  const noTxt = (n) => {
    const t = `"${n.nome.replace(/"/g, "'")}<br/><small>${(n.tecnologias.map(nomeTec).join(', ') || TIPO_ROTULO[n.tipo] || '').replace(/"/g, "'")}</small>"`;
    return n.tipo === 'banco' || n.tipo === 'cache' ? `${sid(n.id)}[(${t})]` : n.tipo === 'pessoa' ? `${sid(n.id)}((${t}))` : n.tipo === 'fila' ? `${sid(n.id)}[/${t}/]` : `${sid(n.id)}[${t}]`;
  };
  const emitirGrupo = (gid, ind) => {
    for (const g of v.grupos.filter(x => (x.pai || '') === gid)) {
      linhas.push(`${ind}subgraph ${sid(g.id)}["${g.nome} [${g.tipo || 'grupo'}]"]`);
      emitirGrupo(g.id, ind + '  ');
      linhas.push(`${ind}end`);
    }
    for (const n of porGrupo.get(gid) || []) linhas.push(ind + noTxt(n));
  };
  emitirGrupo('', '  ');
  for (const c of v.conexoes) {
    const rot = mask(c.rotulo || '').replace(/\n/g, ' / ').replace(/"/g, "'").replace(/\|/g, '/');
    linhas.push(`  ${sid(c.de)} ${c.modo === 'assincrono' ? '-.->' : '-->'}${rot ? `|"${rot}"|` : ''} ${sid(c.para)}`);
  }
  const classes = { pessoa: '#334155', cliente: '#2563EB', infra: '#DC2626', aplicacao: '#16A34A', mensageria: '#9333EA', dados: '#D97706', externo: '#64748B' };
  for (const [c, cor] of Object.entries(classes)) {
    const ids = v.nos.filter(n => n.camada === c).map(n => sid(n.id));
    if (ids.length) linhas.push(`  classDef ${c} stroke:${cor},stroke-width:2px`, `  class ${ids.join(',')} ${c}`);
  }
  return linhas.join('\n') + '\n';
}

// ---------------- execução ----------------
const paginas = [];
const falhas = [];
for (const v of mapa.visoes) {
  try { paginas.push(await pagina(v)); }
  catch (e) { falhas.push(v); console.error(`[build] ERRO na visão "${v}": ${e.message}`); }
}
if (falhas.length) { console.error(`[build] Nada foi gravado: ${falhas.length} visão(ões) falharam. Corrija o mapa e rode de novo.`); process.exit(2); }
const xml = `<mxfile host="mapa-arquitetura" modified="${new Date().toISOString()}" agent="skill mapa-arquitetura" version="1.0" type="device">${paginas.join('')}</mxfile>\n`;
fs.mkdirSync(path.dirname(path.resolve(arqSaida)), { recursive: true });
fs.writeFileSync(arqSaida, xml);
if (opt('--mermaid')) fs.writeFileSync(opt('--mermaid'), mermaid());
const relArq = arqRelatorio;
fs.mkdirSync(path.dirname(relArq), { recursive: true });
fs.writeFileSync(relArq, JSON.stringify(relatorio, null, 2));
console.log(`[build] ${arqSaida}: ${relatorio.paginas.length} página(s) — ${relatorio.paginas.map(p => `${p.titulo} (${p.nos} nós, ${p.conexoes} conexões${p.preservado ? ', mantida como estava' : (anterior ? ', regerada' : '')})`).join('; ')}`);
if (relatorio.semIcone.length) console.log(`[build] Sem logo (usando badge): ${[...new Set(relatorio.semIcone)].join(' | ')}`);
console.log(`[build] Relatório: ${relArq}`);
