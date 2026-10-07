#!/usr/bin/env node
// Checagem automática de qualidade antes da entrega.
// Uso: node validate.mjs <pasta-de-saida>   (a pasta com mapa.json e arquitetura.drawio)
// Saída 0 = ok (pode haver avisos); 1 = há erros que precisam ser corrigidos.
import fs from 'node:fs';
import path from 'node:path';
import { carregarDep } from './_deps.mjs';
import { carregarMapa, acharSegredos, TIPO_PARA_CAMADA, CAMADAS } from './_mapa.mjs';

const pasta = path.resolve(process.argv[2] || 'docs/arquitetura');
const erros = [], avisos = [];
const E = (m) => erros.push(m), A = (m) => avisos.push(m);

// ---------- mapa ----------
const arqMapa = path.join(pasta, 'mapa.json');
if (!fs.existsSync(arqMapa)) { console.error(`[validar] mapa.json não encontrado em ${pasta}`); process.exit(1); }
let m;
try { m = carregarMapa(arqMapa); } catch (e) { console.error(`[validar] mapa.json inválido: ${e.message}`); process.exit(1); }

const ids = new Map();
for (const n of m.nos) {
  if (!n.id) E(`nó sem id: ${JSON.stringify(n).slice(0, 80)}`);
  else if (ids.has(n.id)) E(`id de nó duplicado: ${n.id}`);
  ids.set(n.id, n);
  if (!n.nome) E(`nó ${n.id} sem nome`);
  if (!(n.tipo in TIPO_PARA_CAMADA)) A(`nó ${n.id}: tipo "${n.tipo}" fora da lista conhecida (${Object.keys(TIPO_PARA_CAMADA).join(', ')})`);
  if (!CAMADAS.includes(n.camada)) E(`nó ${n.id}: camada "${n.camada}" inválida (use ${CAMADAS.join(', ')})`);
  if (n.tipo !== 'pessoa' && !n.tecnologias.length && !n.icone) A(`nó ${n.id} sem tecnologia nem ícone: vai aparecer como badge`);
  if ((n.descricao || '').length > 110) A(`nó ${n.id}: descrição com ${n.descricao.length} caracteres (ideal ≤ 110; o card fica alto)`);
  if (n.tipo === 'componente' && !n.pai) E(`componente ${n.id} sem "pai"`);
}
const gids = new Set(m.grupos.map(g => g.id));
for (const n of m.nos) {
  if (n.pai && !ids.has(n.pai)) E(`nó ${n.id}: pai "${n.pai}" não existe`);
  if (n.grupo && !gids.has(n.grupo)) E(`nó ${n.id}: grupo "${n.grupo}" não existe`);
}
for (const g of m.grupos) if (g.pai && !gids.has(g.pai)) E(`grupo ${g.id}: pai "${g.pai}" não existe`);

const grau = new Map();
const pares = new Map();
for (const c of m.conexoes) {
  for (const k of ['de', 'para']) if (!ids.has(c[k])) E(`conexão ${c.id}: "${c[k]}" (${k}) não existe`);
  if (!c.protocolo) E(`conexão ${c.id} (${c.de} → ${c.para}) sem protocolo`);
  if (!c.acao) E(`conexão ${c.id} (${c.de} → ${c.para}) sem ação`);
  if (!['sincrono', 'assincrono'].includes(c.modo)) E(`conexão ${c.id}: modo "${c.modo}" inválido (sincrono | assincrono)`);
  if (/↔|<->|ida e volta|bidirecional/i.test(`${c.acao} ${c.protocolo}`)) E(`conexão ${c.id}: seta bidirecional — separe em duas conexões, cada uma com sua ação`);
  for (const k of [c.de, c.para]) grau.set(k, (grau.get(k) || 0) + 1);
  const chave = `${c.de}→${c.para}|${c.protocolo}|${c.acao}`;
  if (pares.has(chave)) A(`conexão repetida: ${chave}`); pares.set(chave, 1);
}
for (const n of m.nos) {
  const temFilhoLigado = m.nos.some(x => x.pai === n.id && grau.get(x.id));
  if (!grau.get(n.id) && !temFilhoLigado && !n.isolado) A(`nó órfão (sem conexões): ${n.id}. Ligue-o ou marque "isolado": true com o motivo na descrição`);
}
for (const f of m.fluxos) {
  if (!f.passos?.length) E(`fluxo ${f.id} sem passos`);
  (f.passos || []).forEach((p, i) => {
    for (const k of ['de', 'para']) if (!ids.has(p[k])) E(`fluxo ${f.id}, passo ${i + 1}: "${p[k]}" não existe`);
    if (!p.protocolo || !p.acao) E(`fluxo ${f.id}, passo ${i + 1}: falta protocolo ou ação`);
  });
}
for (const v of m.visoes) {
  const [t, alvo] = v.split(':');
  if (t === 'componentes' && !m.nos.some(n => n.pai === alvo)) E(`visão ${v}: "${alvo}" não tem componentes`);
  if (t === 'fluxo' && !m.fluxos.some(f => f.id === alvo)) E(`visão ${v}: fluxo inexistente`);
  if (!['contexto', 'containers', 'componentes', 'fluxo'].includes(t)) E(`visão desconhecida: ${v}`);
}

// ---------- .drawio ----------
const arqDrawio = path.join(pasta, 'arquitetura.drawio');
if (!fs.existsSync(arqDrawio)) E('arquitetura.drawio não foi gerado');
else {
  const xml = fs.readFileSync(arqDrawio, 'utf8');
  const { XMLValidator, XMLParser } = await carregarDep('fast-xml-parser');
  const ok = XMLValidator.validate(xml);
  if (ok !== true) E(`arquitetura.drawio com XML inválido: ${ok.err?.msg} (linha ${ok.err?.line})`);
  else {
    const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: (n) => ['diagram', 'mxCell'].includes(n) });
    const doc = p.parse(xml);
    const diagramas = doc.mxfile?.diagram || [];
    if (diagramas.length !== m.visoes.length) E(`o .drawio tem ${diagramas.length} página(s), mas o mapa pede ${m.visoes.length} visão(ões)`);
    for (const d of diagramas) {
      const cells = d.mxGraphModel?.root?.mxCell || [];
      const cids = new Set(cells.map(c => c.id));
      for (const c of cells) if (c.edge === '1' && c.source) {
        if (!cids.has(c.source) || !cids.has(c.target)) E(`[${d.name}] seta ${c.id} aponta para célula inexistente`);
        if (!String(c.value || '').trim()) E(`[${d.name}] seta ${c.id} sem rótulo`);
      }
    }
  }
}

// ---------- relatório do build (ícones) ----------
const arqRel = path.join(pasta, '.trabalho', 'build-relatorio.json');
if (fs.existsSync(arqRel)) {
  const rel = JSON.parse(fs.readFileSync(arqRel, 'utf8'));
  for (const s of new Set(rel.semIcone || [])) A(`sem logo (badge): ${s}`);
}

// ---------- segredos em todas as saídas ----------
const arqHtml = path.join(pasta, 'arquitetura.html');
if (fs.existsSync(arqHtml) && fs.existsSync(arqDrawio) && fs.statSync(arqHtml).mtimeMs < fs.statSync(arqDrawio).mtimeMs - 2000)
  E('arquitetura.html é mais antigo que o arquitetura.drawio: rode export.mjs e html.mjs de novo');
const saidas = [...fs.readdirSync(pasta).filter(f => /\.(json|drawio|mmd|md|svg|html)$/i.test(f)),
  ...(fs.existsSync(path.join(pasta, 'imagens')) ? fs.readdirSync(path.join(pasta, 'imagens')).filter(f => f.endsWith('.svg')).map(f => path.join('imagens', f)) : [])];
for (const f of saidas) {
  let t = fs.readFileSync(path.join(pasta, f), 'utf8');
  t = t.replace(/data:image\/[a-z+]+[,;][A-Za-z0-9+/=,;]+/g, '');   // ignora ícones embutidos
  for (const s of acharSegredos(t)) E(`POSSÍVEL SEGREDO em ${f}: ${s.tipo} (${s.trecho}). Remova antes de entregar.`);
}

// ---------- resultado ----------
for (const e of erros) console.log(`❌ ${e}`);
for (const a of avisos) console.log(`⚠️  ${a}`);
console.log(`[validar] ${erros.length} erro(s), ${avisos.length} aviso(s) — ${erros.length ? 'CORRIJA os erros e gere de novo' : 'ok para a checagem visual'}`);
process.exit(erros.length ? 1 : 0);
