#!/usr/bin/env node
// Gera stack.md: inventário completo da stack (o que não cabe no diagrama não se perde).
// Uso: node inventario.mjs <scan.json> <mapa.json> <saida.md>
import fs from 'node:fs';
import { carregarMapa, mascarador } from './_mapa.mjs';
import { nomeTec } from './icons.mjs';

const [arqScan, arqMapa, arqSaida] = process.argv.slice(2);
if (!arqScan || !arqMapa || !arqSaida) { console.error('Uso: node inventario.mjs <scan.json> <mapa.json> <saida.md>'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(arqScan, 'utf8'));
const m = carregarMapa(arqMapa);
const mask = mascarador(m);
const L = [];
const tab = (cab, linhas) => { if (!linhas.length) return; L.push(`| ${cab.join(' | ')} |`, `| ${cab.map(() => '---').join(' | ')} |`, ...linhas.map(l => `| ${l.map(x => String(x ?? '').replace(/\|/g, '\\|')).join(' | ')} |`), ''); };

L.push(`# Inventário de stack — ${m.projeto.nome}`, '', `Gerado em ${new Date().toISOString().slice(0, 10)} pelo skill mapa-arquitetura. Complementa o diagrama (\`arquitetura.drawio\`): aqui está tudo o que foi detectado, inclusive o que não aparece no desenho.`, '');
L.push(`**Tamanho:** ${s.resumo.arquivos} arquivos, ${s.resumo.arquivosCodigo} de código (~${s.resumo.linhasCodigo.toLocaleString('pt-BR')} linhas) · **Subprojetos:** ${s.subprojetos.join(', ') || '(raiz)'}`, '');

const usoEmNos = (chave) => m.nos.filter(n => n.tecnologias.includes(chave)).map(n => n.nome).join(', ');
const cats = { linguagem: 'Linguagens', runtime: 'Runtimes', framework: 'Frameworks', 'biblioteca-chave': 'Bibliotecas que definem a arquitetura', banco: 'Bancos de dados', cache: 'Cache', fila: 'Filas e mensageria', storage: 'Armazenamento', cloud: 'Nuvem', infra: 'Infraestrutura e DevOps', ferramenta: 'Ferramentas', llm: 'Modelos de IA (LLM)', 'mensageria-externa': 'Canais de mensagem', servico: 'Serviços externos (SaaS/APIs)' };
L.push('## Tecnologias detectadas', '');
for (const [cat, titulo] of Object.entries(cats)) {
  const ts = s.tecnologias.filter(t => t.categoria === cat);
  if (!ts.length) continue;
  L.push(`### ${titulo}`, '');
  tab(['Tecnologia', 'Onde aparece no diagrama', 'Evidência no código'], ts.map(t => [t.nome + (t.somenteDev ? ' *(só dev)*' : ''), usoEmNos(t.chave) || '—', t.evidencias.slice(0, 3).map(e => `\`${mask(e)}\``).join(', ')]));
}
const noMapaSemScan = [...new Set(m.nos.flatMap(n => n.tecnologias))].filter(k => !s.tecnologias.some(t => t.chave === k));
if (noMapaSemScan.length) L.push(`> Declaradas no mapa mas não detectadas automaticamente: ${noMapaSemScan.map(nomeTec).join(', ')}.`, '');

L.push('## Componentes do diagrama', '');
tab(['Nó', 'Tipo', 'Camada', 'Tecnologias', 'Descrição'], m.nos.map(n => [n.nome, n.tipo, n.camada, n.tecnologias.map(nomeTec).join(', '), mask(n.descricao || '')]));
L.push('## Comunicação entre as partes', '');
const nome = (id) => m.nos.find(n => n.id === id)?.nome || id;
tab(['De', 'Para', 'Protocolo', 'Ação', 'Modo'], m.conexoes.map(c => [nome(c.de), nome(c.para), c.protocolo, mask(c.acao), c.modo === 'assincrono' ? 'assíncrono' : 'síncrono']));

if (s.rotas.length) { L.push('## Rotas HTTP', ''); tab(['Método', 'Caminho', 'Arquivo'], s.rotas.slice(0, 150).map(r => [r.metodo, `\`${r.caminho}\``, `\`${r.arquivo}\``])); }
if (s.n8n.length) {
  L.push('## Workflows n8n', '');
  for (const w of s.n8n) {
    L.push(`### ${w.nome}${w.ativo === false ? ' *(inativo)*' : ''}`, '', `Arquivo: \`${w.arquivo}\``, '');
    tab(['Nó', 'Tipo', 'Gatilho', 'Credencial (tipo)'], w.nodes.map(n => [n.nome, n.tipo, n.gatilho ? 'sim' : '', (n.credenciais || []).join(', ')]));
  }
}
if (s.docker.compose.length) {
  L.push('## Serviços Docker', '');
  for (const c of s.docker.compose) tab(['Serviço', 'Imagem / build', 'Portas', 'Depende de'], (c.services || []).map(x => [x.nome, x.imagem || `build: ${x.build}`, x.portas.join(', '), x.dependeDe.join(', ')]));
}
if (s.env.length) {
  L.push('## Variáveis de ambiente', '', '*Somente os nomes. Os valores nunca são lidos.*', '');
  tab(['Variável', 'Onde é definida/usada'], s.env.map(e => [`\`${e.nome}\``, e.origens.slice(0, 3).map(o => `\`${o}\``).join(', ')]));
}
const ext = s.hosts.filter(h => !h.interno);
if (ext.length) { L.push('## Hosts externos chamados no código', ''); tab(['Host', 'Arquivos'], ext.map(h => [mask(h.host), h.arquivos.slice(0, 3).map(a => `\`${a}\``).join(', ')])); }
if (s.iac.length || s.ci.length) {
  L.push('## Infraestrutura como código e CI/CD', '');
  tab(['Tipo', 'Arquivo', 'Detalhe'], [...s.iac.map(i => [i.tipo, `\`${i.arquivo}\``, (i.recursos || i.funcoes || i.kinds || []).slice(0, 8).join(', ')]), ...s.ci.map(c => [c.tipo, `\`${c.arquivo}\``, c.nome || ''])]);
}
L.push('## Dependências completas', '');
for (const [eco, deps] of Object.entries(s.dependencias)) {
  const ks = Object.keys(deps); if (!ks.length) continue;
  const prod = ks.filter(k => !deps[k].dev), dev = ks.filter(k => deps[k].dev);
  L.push(`<details><summary><b>${eco}</b> — ${prod.length} de produção, ${dev.length} de desenvolvimento</summary>`, '', prod.map(k => `\`${k}\``).join(' · ') || '—', '', dev.length ? `*dev:* ${dev.map(k => `\`${k}\``).join(' · ')}` : '', '</details>', '');
}
if (s.arquivosSegredoIgnorados?.length) L.push(`> ${s.arquivosSegredoIgnorados.length} arquivo(s) com cara de credencial foram ignorados na leitura.`, '');
fs.writeFileSync(arqSaida, L.join('\n'));
console.log(`[inventario] ${arqSaida}`);
