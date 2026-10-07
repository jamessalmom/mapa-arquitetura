// Funções compartilhadas: normalização do mapa, derivação das visões e mascaramento.
import fs from 'node:fs';

export const CAMADAS = ['pessoa', 'cliente', 'infra', 'aplicacao', 'mensageria', 'dados', 'externo'];
export const TIPO_PARA_CAMADA = { pessoa: 'pessoa', app: 'cliente', frontend: 'cliente', mobile: 'cliente', servico: 'aplicacao', api: 'aplicacao',
  worker: 'aplicacao', workflow: 'aplicacao', job: 'aplicacao', componente: 'aplicacao', banco: 'dados', cache: 'dados', storage: 'dados',
  fila: 'mensageria', topico: 'mensageria', infra: 'infra', gateway: 'infra', externo: 'externo' };
export const TIPO_ROTULO = { pessoa: 'Pessoa', app: 'Aplicação', frontend: 'Front-end', mobile: 'App mobile', servico: 'Serviço', api: 'API',
  worker: 'Worker', workflow: 'Workflow', job: 'Job agendado', componente: 'Componente', banco: 'Banco de dados', cache: 'Cache',
  storage: 'Storage', fila: 'Fila', topico: 'Tópico', infra: 'Infra', gateway: 'Gateway', externo: 'Externo', sistema: 'Sistema' };
export const CAMADA_ROTULO = { pessoa: 'Pessoas', cliente: 'Cliente / front-end', infra: 'Infraestrutura / borda', aplicacao: 'Aplicação / backend',
  mensageria: 'Mensageria / filas', dados: 'Dados / armazenamento', externo: 'Serviços externos', sistema: 'O sistema' };

/** Cores do diagrama (usadas pelo .drawio e pelo HTML). camada: [preenchimento, borda]. */
export function paleta(escuro) {
  return escuro ? {
    fundo: '#0F172A', texto: '#E2E8F0', textoSec: '#94A3B8', seta: '#94A3B8', grupo: '#64748B',
    camada: { pessoa: ['#1E293B', '#E2E8F0'], cliente: ['#172554', '#60A5FA'], infra: ['#3B0D0C', '#F87171'], aplicacao: ['#052E16', '#4ADE80'],
      mensageria: ['#2E1065', '#C084FC'], dados: ['#422006', '#FBBF24'], externo: ['#1F2937', '#9CA3AF'], sistema: ['#1D4ED8', '#93C5FD'] }
  } : {
    fundo: '#FFFFFF', texto: '#1F2937', textoSec: '#6B7280', seta: '#475569', grupo: '#94A3B8',
    camada: { pessoa: ['#FFFFFF', '#334155'], cliente: ['#EFF6FF', '#2563EB'], infra: ['#FEF2F2', '#DC2626'], aplicacao: ['#F0FDF4', '#16A34A'],
      mensageria: ['#FAF5FF', '#9333EA'], dados: ['#FFFBEB', '#D97706'], externo: ['#F8FAFC', '#64748B'], sistema: ['#1E40AF', '#1E3A8A'] }
  };
}

export function carregarMapa(arq) {
  const m = JSON.parse(fs.readFileSync(arq, 'utf8'));
  return normalizar(m);
}

export function normalizar(m) {
  m.projeto ||= {}; m.projeto.nome ||= 'Projeto';
  m.projeto.tema ||= 'claro';
  if (m.projeto.mascararHosts === undefined) m.projeto.mascararHosts = true;
  m.grupos ||= []; m.nos ||= []; m.conexoes ||= []; m.fluxos ||= [];
  for (const n of m.nos) {
    n.tipo ||= 'servico';
    n.camada ||= TIPO_PARA_CAMADA[n.tipo] || 'aplicacao';
    n.tecnologias ||= [];
  }
  m.conexoes.forEach((c, i) => { c.id ||= `c${i + 1}`; c.modo ||= 'sincrono'; });
  if (!m.visoes || !m.visoes.length) {
    m.visoes = ['contexto', 'containers'];
    for (const n of m.nos) if (n.tipo !== 'componente' && m.nos.some(x => x.pai === n.id)) m.visoes.push(`componentes:${n.id}`);
    for (const f of m.fluxos) m.visoes.push(`fluxo:${f.id}`);
  }
  return m;
}

export const ehInterno = (n) => n && n.tipo !== 'pessoa' && n.tipo !== 'externo' && n.camada !== 'externo' && n.camada !== 'pessoa';

const rotuloConexao = (c) => [c.protocolo, c.acao].filter(Boolean).join(' · ');

function mesclar(lista) {
  // junta conexões repetidas entre o mesmo par (mesma direção)
  const mapa = new Map();
  for (const c of lista) {
    const k = `${c.de}→${c.para}`;
    const e = mapa.get(k);
    if (!e) { mapa.set(k, { ...c, _rotulos: [rotuloConexao(c)], _modos: new Set([c.modo]), _itens: [c] }); continue; }
    e._rotulos.push(rotuloConexao(c)); e._modos.add(c.modo); e._itens.push(c);
  }
  return [...mapa.values()].map(e => {
    const unicos = [...new Set(e._rotulos.filter(Boolean))];
    const protos = [...new Set(unicos.map(r => r.split(' · ')[0]))];
    const rotulo = unicos.length <= 1 ? (unicos[0] || '') : unicos.length <= 2 ? unicos.join('\n') : `${protos.join(' / ')} · ${unicos.length} interações`;
    return { ...e, rotulo, modo: e._modos.size === 1 ? [...e._modos][0] : 'sincrono' };
  });
}

/** Devolve { titulo, subtitulo, nos, grupos, conexoes, numerada } para uma visão. */
export function derivarVisao(m, visao) {
  const porId = new Map(m.nos.map(n => [n.id, n]));
  const [tipo, alvo] = visao.split(':');
  const paiDe = (id) => { let n = porId.get(id); while (n && n.tipo === 'componente' && n.pai && porId.get(n.pai)) n = porId.get(n.pai); return n?.id || id; };

  if (tipo === 'contexto') {
    const sistema = { id: '__sistema', nome: m.projeto.nome, tipo: 'sistema', camada: 'sistema', descricao: m.projeto.descricao || '',
      tecnologias: m.projeto.tecnologiasPrincipais || principaisTecs(m) };
    const ext = m.nos.filter(n => !ehInterno(n) && n.tipo !== 'componente');
    const lift = (id) => { const t = porId.get(paiDe(id)); return ehInterno(t) ? '__sistema' : t?.id; };
    const conexoes = mesclar(m.conexoes.map(c => ({ ...c, de: lift(c.de), para: lift(c.para) })).filter(c => c.de && c.para && c.de !== c.para));
    return { titulo: 'Visão de contexto', subtitulo: 'O sistema, quem o usa e com quais serviços externos ele conversa', nos: [sistema, ...ext], grupos: [], conexoes };
  }
  if (tipo === 'containers') {
    const nos = m.nos.filter(n => n.tipo !== 'componente');
    const ids = new Set(nos.map(n => n.id));
    const conexoes = mesclar(m.conexoes.map(c => ({ ...c, de: paiDe(c.de), para: paiDe(c.para) })).filter(c => ids.has(c.de) && ids.has(c.para) && c.de !== c.para));
    return { titulo: 'Visão de containers', subtitulo: 'Aplicações, serviços, dados e integrações — com tecnologias e protocolos', nos, grupos: gruposUsados(m, nos), conexoes };
  }
  if (tipo === 'componentes') {
    const cont = porId.get(alvo);
    if (!cont) throw new Error(`Visão ${visao}: nó "${alvo}" não existe`);
    const comps = m.nos.filter(n => n.pai === alvo);
    const idsComp = new Set(comps.map(n => n.id));
    const grupoCont = { id: `__cont_${alvo}`, nome: cont.nome, tipo: TIPO_ROTULO[cont.tipo] || cont.tipo, tecnologias: cont.tecnologias, _container: true };
    const ext = new Map();
    const conexoes = [];
    for (const c of m.conexoes) {
      const deIn = idsComp.has(c.de), paraIn = idsComp.has(c.para);
      if (!deIn && !paraIn) continue;
      const fora = (id) => { const pid = paiDe(id); if (pid !== alvo) ext.set(pid, porId.get(pid)); return pid; };
      conexoes.push({ ...c, de: deIn ? c.de : fora(c.de), para: paraIn ? c.para : fora(c.para) });
    }
    return { titulo: `Componentes — ${cont.nome}`, subtitulo: 'Módulos internos e com quem cada um conversa',
      nos: [...comps.map(n => ({ ...n, grupo: grupoCont.id })), ...[...ext.values()].filter(Boolean).map(n => ({ ...n, grupo: undefined, _vizinho: true }))],
      grupos: [grupoCont], conexoes: mesclar(conexoes.filter(c => c.de !== c.para)) };
  }
  if (tipo === 'fluxo') {
    const f = m.fluxos.find(x => x.id === alvo);
    if (!f) throw new Error(`Visão ${visao}: fluxo "${alvo}" não existe`);
    const ids = []; for (const p of f.passos) for (const id of [p.de, p.para]) if (!ids.includes(id)) ids.push(id);
    const nos = ids.map(id => { const n = porId.get(id); if (!n) throw new Error(`Fluxo ${alvo}: nó "${id}" não existe`); return { ...n }; });
    const conexoes = f.passos.map((p, i) => ({ ...p, id: `${alvo}_p${i + 1}`, numero: i + 1, rotulo: `${numeral(i + 1)} ${rotuloConexao(p)}`, modo: p.modo || 'sincrono' }));
    return { titulo: `Fluxo — ${f.nome}`, subtitulo: f.descricao || 'Passo a passo numerado do caminho crítico', nos, grupos: gruposUsados(m, nos), conexoes, numerada: true };
  }
  throw new Error(`Visão desconhecida: ${visao}`);
}

function gruposUsados(m, nos) {
  const porId = new Map(m.grupos.map(g => [g.id, g]));
  const usados = new Set();
  for (const n of nos) { let g = n.grupo; while (g && porId.get(g) && !usados.has(g)) { usados.add(g); g = porId.get(g).pai; } }
  return m.grupos.filter(g => usados.has(g.id));
}

function principaisTecs(m) {
  const cont = {};
  for (const n of m.nos) if (ehInterno(n)) for (const t of n.tecnologias) cont[t] = (cont[t] || 0) + 1;
  return Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]);
}

export function numeral(n) { return n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : `(${n})`; }

// ---------- mascaramento ----------
export function mascarador(m) {
  if (!m.projeto.mascararHosts) return (s) => s;
  const privados = (m.projeto.hostsPrivados || []).map(h => h.toLowerCase());
  return (s) => {
    if (!s) return s;
    let t = String(s).replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***:***@');
    t = t.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, 'x.x.x.x');
    t = t.replace(/\b([a-z0-9-]+)((?:\.[a-z0-9-]+)*\.(?:local|lan|internal|intranet|corp|home))\b/gi, '$1.***');
    for (const h of privados) t = t.split(h).join(h.split('.')[0] + '.***');
    return t;
  };
}

// ---------- segredos ----------
export const PADROES_SEGREDO = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'chave Anthropic'], [/\bsk-(proj-)?[A-Za-z0-9]{20,}/, 'chave OpenAI'], [/AKIA[0-9A-Z]{16}/, 'chave AWS'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'token GitHub'], [/xox[abposr]-[A-Za-z0-9-]{10,}/, 'token Slack'], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'chave privada'],
  [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/, 'JWT'], [/AIza[0-9A-Za-z_-]{35}/, 'chave Google'],
  [/\b(password|senha|passwd|secret|token|api[_-]?key)\s*[=:]\s*['"]?[A-Za-z0-9_\-+/=]{8,}(?![\w.(])/i, 'atribuição de segredo'],
  [/[a-z]+:\/\/[^/\s:@]+:[^/\s@*]{3,}@/i, 'URL com credencial'], [/\bEAA[A-Za-z0-9]{40,}/, 'token Meta/WhatsApp']
];
export function acharSegredos(texto) {
  const achados = [];
  for (const [re, nome] of PADROES_SEGREDO) { const m = texto.match(re); if (m) achados.push({ tipo: nome, trecho: m[0].slice(0, 6) + '…' }); }
  return achados;
}
