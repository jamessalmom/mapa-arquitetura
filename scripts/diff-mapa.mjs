#!/usr/bin/env node
// Compara o mapa anterior com o novo (modo atualização) e imprime o que mudou, em Markdown.
// Uso: node diff-mapa.mjs <mapa.anterior.json> <mapa.json>
import fs from 'node:fs';
import { normalizar } from './_mapa.mjs';

const [a, b] = process.argv.slice(2).map(f => normalizar(JSON.parse(fs.readFileSync(f, 'utf8'))));
const out = [];
const porId = (m) => new Map(m.nos.map(n => [n.id, n]));
const A = porId(a), B = porId(b);
const novos = [...B.keys()].filter(k => !A.has(k)), removidos = [...A.keys()].filter(k => !B.has(k));
const alterados = [];
for (const [k, n] of B) {
  const o = A.get(k); if (!o) continue;
  const dif = [];
  if (o.nome !== n.nome) dif.push(`nome "${o.nome}" → "${n.nome}"`);
  const tA = o.tecnologias.join(','), tB = n.tecnologias.join(',');
  if (tA !== tB) dif.push(`tecnologias [${tA}] → [${tB}]`);
  if ((o.grupo || '') !== (n.grupo || '')) dif.push(`grupo ${o.grupo || '—'} → ${n.grupo || '—'}`);
  if (o.tipo !== n.tipo) dif.push(`tipo ${o.tipo} → ${n.tipo}`);
  if (dif.length) alterados.push(`${n.nome}: ${dif.join('; ')}`);
}
const ck = (c) => `${c.de} → ${c.para} (${c.protocolo} · ${c.acao})`;
const cA = new Set(a.conexoes.map(ck)), cB = new Set(b.conexoes.map(ck));
const cNovas = [...cB].filter(x => !cA.has(x)), cRem = [...cA].filter(x => !cB.has(x));

if (novos.length) out.push('**Novos:** ' + novos.map(k => B.get(k).nome).join(', '));
if (removidos.length) out.push('**Removidos:** ' + removidos.map(k => A.get(k).nome).join(', '));
if (alterados.length) out.push('**Alterados:**\n' + alterados.map(x => `- ${x}`).join('\n'));
if (cNovas.length) out.push('**Conexões novas:**\n' + cNovas.map(x => `- ${x}`).join('\n'));
if (cRem.length) out.push('**Conexões removidas:**\n' + cRem.map(x => `- ${x}`).join('\n'));
console.log(out.length ? out.join('\n\n') : 'Nenhuma mudança estrutural desde a última geração.');
