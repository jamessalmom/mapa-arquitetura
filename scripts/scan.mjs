#!/usr/bin/env node
// Varredura determinística do projeto. Produz um JSON com manifestos, dependências,
// tecnologias detectadas, serviços docker, workflows n8n, variáveis de ambiente (SÓ OS NOMES),
// hosts externos chamados no código, rotas, entrypoints, IaC e CI.
// Uso: node scan.mjs <raiz-do-projeto> [--saida arquivo.json]
// Regra de segurança: nunca lê nem grava VALORES de .env, nem conteúdo de arquivos de segredo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarDep } from './_deps.mjs';
import { acharSegredos } from './_mapa.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const raiz = path.resolve(args.find((a, i) => !a.startsWith('--') && !['--saida', '--ignorar'].includes(args[i - 1])) || '.');
const saidaIdx = args.indexOf('--saida');
const saida = saidaIdx >= 0 ? args[saidaIdx + 1] : null;
const ignIdx = args.indexOf('--ignorar');
// a própria pasta de saída do skill nunca entra na varredura
const ignorarRel = [ignIdx >= 0 ? args[ignIdx + 1] : 'docs/arquitetura', saida ? path.relative(raiz, path.dirname(path.dirname(path.resolve(saida)))) : null]
  .filter(x => x && !x.startsWith('..')).map(x => x.split(path.sep).join('/').replace(/\/$/, ''));

const YAML = await carregarDep('yaml');
const techMap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'tech-map.json'), 'utf8'));
delete techMap._sobre;

const IGNORAR_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', 'venv', '.venv', 'env', '__pycache__', '.mypy_cache',
  '.pytest_cache', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', 'coverage', 'vendor',
  'target', 'bin', 'obj', '.idea', '.vscode', '.gradle', '.terraform', 'site-packages', '.tox', 'bower_components',
  'Pods', '.dart_tool', '.expo', 'tmp', 'logs', '.trabalho']);
const EXT_CODIGO = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.php', '.java', '.kt', '.cs', '.go',
  '.rs', '.rb', '.dart', '.vue', '.svelte', '.astro', '.sql', '.sh', '.ps1', '.swift', '.scala', '.ex', '.exs']);
const EXT_CONFIG = new Set(['.json', '.yml', '.yaml', '.toml', '.xml', '.conf', '.ini', '.tf', '.gradle', '.csproj']);
const MAX_BYTES_LEITURA = 400 * 1024;
const ARQ_SEGREDO = /(^|\/)(id_rsa|id_ed25519|.*\.pem|.*\.key|.*\.p12|.*\.pfx|credentials(\.json)?|service[-_]?account.*\.json|secrets?\.(json|ya?ml))$/i;

// ---------- caminhada ----------
const arquivos = [];
function caminhar(dir) {
  let entradas;
  try { entradas = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entradas) {
    const abs = path.join(dir, e.name);
    const rel = path.relative(raiz, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (IGNORAR_DIRS.has(e.name) || ignorarRel.includes(rel)) continue;
      if (e.name.startsWith('.') && !['.github', '.gitlab', '.circleci', '.devcontainer', '.n8n'].includes(e.name)) continue;
      caminhar(abs);
    } else if (e.isFile()) {
      let tam = 0; try { tam = fs.statSync(abs).size; } catch {}
      arquivos.push({ rel, abs, nome: e.name, ext: path.extname(e.name).toLowerCase(), tam });
    }
  }
}
caminhar(raiz);

const ler = (a) => { try { return a.tam <= MAX_BYTES_LEITURA ? fs.readFileSync(a.abs, 'utf8') : ''; } catch { return ''; } };
const ehEnv = (n) => /^\.env(\..+)?$/i.test(n) || /\.env$/i.test(n);

// ---------- resultado ----------
const r = {
  raiz, geradoEm: new Date().toISOString(),
  resumo: {}, modulos: [], subprojetos: [], manifestos: [],
  dependencias: { npm: {}, pypi: {}, composer: {}, gomod: {}, maven: {}, nuget: {}, gem: {} },
  tecnologias: [], docker: { compose: [], dockerfiles: [] }, n8n: [],
  env: [], hosts: [], rotas: [], entrypoints: [], iac: [], ci: [], arquivosSegredoIgnorados: [], segredosNoCodigo: []
};
const addDep = (eco, nome, arq, dev = false) => {
  const k = nome.trim(); if (!k) return;
  (r.dependencias[eco][k] ||= { arquivos: [], dev }).arquivos.push(arq);
};

// ---------- manifestos ----------
for (const a of arquivos) {
  if (ARQ_SEGREDO.test(a.rel)) { r.arquivosSegredoIgnorados.push(a.rel); continue; }
  const n = a.nome;
  try {
    if (n === 'package.json') {
      const j = JSON.parse(ler(a) || '{}');
      r.manifestos.push({ tipo: 'npm', arquivo: a.rel, nome: j.name, scripts: Object.keys(j.scripts || {}), main: j.main, bin: j.bin ? Object.keys(typeof j.bin === 'string' ? { [j.name]: 1 } : j.bin) : undefined, workspaces: j.workspaces });
      for (const d of Object.keys(j.dependencies || {})) addDep('npm', d, a.rel);
      for (const d of Object.keys(j.devDependencies || {})) addDep('npm', d, a.rel, true);
      if (j.scripts?.start) r.entrypoints.push({ arquivo: a.rel, via: 'npm start', comando: j.scripts.start });
      if (j.main) r.entrypoints.push({ arquivo: a.rel, via: 'main', comando: j.main });
    } else if (/^requirements.*\.txt$/i.test(n)) {
      r.manifestos.push({ tipo: 'pip', arquivo: a.rel });
      for (const l of ler(a).split(/\r?\n/)) { const m = l.trim().match(/^([A-Za-z0-9_.\-\[\]]+)/); if (m && !l.trim().startsWith('#') && !l.trim().startsWith('-')) addDep('pypi', m[1].replace(/\[.*\]/, '').toLowerCase(), a.rel, /dev|test/i.test(n)); }
    } else if (n === 'pyproject.toml') {
      const t = ler(a); r.manifestos.push({ tipo: 'pyproject', arquivo: a.rel });
      const blocoDeps = t.match(/dependencies\s*=\s*\[([\s\S]*?)\]/g) || [];
      for (const b of blocoDeps) for (const m of b.matchAll(/["']([A-Za-z0-9_.\-]+)/g)) addDep('pypi', m[1].toLowerCase(), a.rel);
      const poetry = t.match(/\[tool\.poetry\.(?:dev-)?dependencies\]([\s\S]*?)(\n\[|$)/g) || [];
      for (const b of poetry) for (const m of b.matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=/gm)) if (m[1] !== 'python') addDep('pypi', m[1].toLowerCase(), a.rel);
      const sc = t.match(/\[project\.scripts\]([\s\S]*?)(\n\[|$)/); if (sc) r.entrypoints.push({ arquivo: a.rel, via: 'project.scripts', comando: sc[1].trim().split('\n')[0] });
    } else if (n === 'Pipfile') {
      r.manifestos.push({ tipo: 'pipenv', arquivo: a.rel });
      for (const m of ler(a).matchAll(/^\s*([A-Za-z0-9_.\-]+)\s*=\s*["'{*]/gm)) if (!['python_version', 'url', 'verify_ssl', 'name'].includes(m[1])) addDep('pypi', m[1].toLowerCase(), a.rel);
    } else if (n === 'composer.json') {
      const j = JSON.parse(ler(a) || '{}'); r.manifestos.push({ tipo: 'composer', arquivo: a.rel, nome: j.name });
      for (const d of Object.keys(j.require || {})) addDep('composer', d, a.rel);
      for (const d of Object.keys(j['require-dev'] || {})) addDep('composer', d, a.rel, true);
    } else if (n === 'go.mod') {
      r.manifestos.push({ tipo: 'gomod', arquivo: a.rel });
      for (const m of ler(a).matchAll(/^\s*(?:require\s+)?([a-z0-9.\-]+\.[a-z]+\/[^\s]+)\s+v/gm)) addDep('gomod', m[1], a.rel);
    } else if (n === 'pom.xml' || /^build\.gradle(\.kts)?$/.test(n)) {
      r.manifestos.push({ tipo: n === 'pom.xml' ? 'maven' : 'gradle', arquivo: a.rel });
      const t = ler(a);
      for (const m of t.matchAll(/<artifactId>([^<]+)<\/artifactId>/g)) addDep('maven', m[1], a.rel);
      for (const m of t.matchAll(/["']([\w.\-]+):([\w.\-]+):[\w.\-]+["']/g)) addDep('maven', m[2], a.rel);
    } else if (a.ext === '.csproj') {
      r.manifestos.push({ tipo: 'nuget', arquivo: a.rel });
      for (const m of ler(a).matchAll(/PackageReference\s+Include="([^"]+)"/g)) addDep('nuget', m[1], a.rel);
    } else if (n === 'Gemfile') {
      r.manifestos.push({ tipo: 'gem', arquivo: a.rel });
      for (const m of ler(a).matchAll(/^\s*gem\s+["']([^"']+)/gm)) addDep('gem', m[1], a.rel);
    }
  } catch (e) { r.manifestos.push({ tipo: 'erro', arquivo: a.rel, erro: String(e.message).slice(0, 120) }); }
}

// ---------- docker ----------
for (const a of arquivos) {
  if (/^(docker-)?compose(\.[\w-]+)?\.ya?ml$/i.test(a.nome)) {
    try {
      const doc = YAML.parse(ler(a)) || {};
      const services = Object.entries(doc.services || {}).map(([nome, s]) => ({
        nome, imagem: s.image, build: s.build ? (typeof s.build === 'string' ? s.build : s.build.context || '.') : undefined,
        portas: (s.ports || []).map(String), dependeDe: Array.isArray(s.depends_on) ? s.depends_on : Object.keys(s.depends_on || {}),
        redes: Array.isArray(s.networks) ? s.networks : Object.keys(s.networks || {}),
        envKeys: Array.isArray(s.environment) ? s.environment.map(x => String(x).split('=')[0]) : Object.keys(s.environment || {}),
        volumes: (s.volumes || []).length, comando: s.command ? String(s.command).slice(0, 120) : undefined
      }));
      r.docker.compose.push({ arquivo: a.rel, services, redes: Object.keys(doc.networks || {}) });
    } catch (e) { r.docker.compose.push({ arquivo: a.rel, erro: String(e.message).slice(0, 120) }); }
  } else if (/^Dockerfile(\..+)?$/i.test(a.nome) || a.nome.endsWith('.Dockerfile')) {
    const t = ler(a);
    r.docker.dockerfiles.push({ arquivo: a.rel, from: [...t.matchAll(/^\s*FROM\s+([^\s]+)/gim)].map(m => m[1]),
      expose: [...t.matchAll(/^\s*EXPOSE\s+(.+)$/gim)].map(m => m[1].trim()),
      cmd: (t.match(/^\s*(CMD|ENTRYPOINT)\s+(.+)$/im) || [])[2] });
  }
}

// ---------- .env (somente nomes) ----------
const envMap = new Map();
const addEnv = (k, origem) => { if (!/^[A-Za-z_][A-Za-z0-9_]{1,}$/.test(k)) return; const s = envMap.get(k) || new Set(); s.add(origem); envMap.set(k, s); };
for (const a of arquivos) {
  if (!ehEnv(a.nome)) continue;
  for (const l of ler(a).split(/\r?\n/)) { const m = l.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/); if (m) addEnv(m[1], a.rel); }
}

// ---------- n8n ----------
for (const a of arquivos) {
  if (a.ext !== '.json' || a.tam > 3 * 1024 * 1024) continue;
  const t = a.tam <= MAX_BYTES_LEITURA ? ler(a) : (() => { try { return fs.readFileSync(a.abs, 'utf8'); } catch { return ''; } })();
  if (!t.includes('"nodes"') || !/n8n-nodes-|@n8n\//.test(t)) continue;
  try {
    const j = JSON.parse(t);
    const wfs = Array.isArray(j) ? j : [j];
    for (const wf of wfs) {
      if (!Array.isArray(wf.nodes)) continue;
      const nodes = wf.nodes.map(nd => ({
        nome: nd.name, tipo: String(nd.type || '').replace(/^n8n-nodes-base\./, '').replace(/^@n8n\/n8n-nodes-langchain\./, 'langchain.'),
        gatilho: /trigger|webhook|cron|schedule/i.test(nd.type || ''),
        webhookPath: nd.parameters?.path, metodo: nd.parameters?.httpMethod,
        httpUrlHost: (() => { const u = nd.parameters?.url; if (typeof u !== 'string') return undefined; const m = u.match(/^https?:\/\/([^/:?#]+)/); return m ? m[1] : (u.startsWith('=') ? '(expressão)' : undefined); })(),
        credenciais: nd.credentials ? Object.keys(nd.credentials) : undefined
      }));
      const conexoes = [];
      for (const [orig, outs] of Object.entries(wf.connections || {}))
        for (const [tipoSaida, listas] of Object.entries(outs || {}))
          for (const lista of listas || []) for (const c of lista || []) conexoes.push({ de: orig, para: c.node, tipo: tipoSaida });
      r.n8n.push({ arquivo: a.rel, nome: wf.name || path.basename(a.rel, '.json'), ativo: wf.active, nodes, conexoes });
    }
  } catch {}
}

// ---------- código: env usado, hosts, rotas ----------
const hostMap = new Map();
const IGN_HOST = /^(localhost|127\.|0\.0\.0\.0|example\.(com|org)|www\.w3\.org|schemas\.|schema\.org|json-schema\.org|xmlns|purl\.org|www\.apache\.org|opensource\.org|creativecommons\.org|fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|github\.com\/[^/]+\/[^/]+\/(blob|issues)|registry\.npmjs\.org|pypi\.org|reactjs\.org|nextjs\.org|developer\.mozilla\.org)/i;
const addHost = (h, arq) => { h = h.toLowerCase(); if (IGN_HOST.test(h) || !h.includes('.') && !h.includes(':')) return; const s = hostMap.get(h) || new Set(); s.add(arq); hostMap.set(h, s); };
const rotas = [];
const RE_ENV = [/process\.env\.([A-Z_][A-Z0-9_]*)/g, /process\.env\[['"]([A-Za-z_][\w]*)['"]\]/g, /import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g,
  /os\.environ(?:\.get)?\(\s*['"]([A-Za-z_][\w]*)['"]/g, /os\.environ\[['"]([A-Za-z_][\w]*)['"]\]/g, /os\.getenv\(\s*['"]([A-Za-z_][\w]*)['"]/g,
  /\bgetenv\(\s*['"]([A-Za-z_][\w]*)['"]/g, /\benv\(\s*['"]([A-Z_][A-Z0-9_]*)['"]/g, /Environment\.GetEnvironmentVariable\(\s*"([\w]+)"/g, /os\.Getenv\(\s*"([\w]+)"/g];
const RE_ROTAS = [
  { re: /\b(app|router|server|api|fastify|r)\.(get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g, f: m => [m[2], m[3]] },
  { re: /@\w+\.(get|post|put|patch|delete|route|websocket)\(\s*['"]([^'"]+)['"]/g, f: m => [m[1], m[2]] },
  { re: /Route::(get|post|put|patch|delete|any|resource|apiResource)\(\s*['"]([^'"]+)['"]/g, f: m => [m[1], m[2]] },
  { re: /@(Get|Post|Put|Patch|Delete)Mapping\(\s*(?:value\s*=\s*)?"([^"]*)"/g, f: m => [m[1], m[2]] },
  { re: /@(Get|Post|Put|Patch|Delete)\(\s*['"]([^'"]*)['"]\s*\)/g, f: m => [m[1], m[2]] }
];
let linhasCodigo = 0; const contExt = {};
for (const a of arquivos) {
  const ehCod = EXT_CODIGO.has(a.ext);
  if (ehCod) contExt[a.ext] = (contExt[a.ext] || 0) + 1;
  if (!(ehCod || (EXT_CONFIG.has(a.ext) && !a.rel.includes('lock'))) || ehEnv(a.nome) || ARQ_SEGREDO.test(a.rel)) continue;
  const t = ler(a); if (!t) continue;
  if (ehCod) linhasCodigo += t.split('\n').length;
  for (const re of RE_ENV) for (const m of t.matchAll(re)) addEnv(m[1], a.rel + ' (código)');
  // segredo escrito direto no código: registra só arquivo e tipo, NUNCA o valor
  for (const sg of acharSegredos(t)) if (r.segredosNoCodigo.length < 50) r.segredosNoCodigo.push({ arquivo: a.rel, tipo: sg.tipo });
  for (const m of t.matchAll(/https?:\/\/([a-zA-Z0-9.\-]+(?::\d+)?)/g)) addHost(m[1], a.rel);
  if (ehCod) for (const { re, f } of RE_ROTAS) for (const m of t.matchAll(re)) { const [met, p] = f(m); if (rotas.length < 300) rotas.push({ metodo: met.toUpperCase(), caminho: p, arquivo: a.rel }); }
  // Next.js app router / pages api
  const nx = a.rel.match(/(?:^|\/)app\/(.*)\/route\.(t|j)sx?$/) || a.rel.match(/(?:^|\/)pages\/api\/(.*)\.(t|j)sx?$/);
  if (nx && rotas.length < 300) rotas.push({ metodo: 'ANY', caminho: '/' + nx[1].replace(/\/index$/, '').replace(/\[(.+?)\]/g, ':$1'), arquivo: a.rel });
}
r.rotas = [...new Map(rotas.map(x => [`${x.metodo} ${x.caminho} ${x.arquivo}`, x])).values()];

// ---------- entrypoints heurísticos ----------
const NOMES_ENTRY = /^(index|main|app|server|manage|wsgi|asgi|run|bot|worker|cli|Program)\.(js|mjs|ts|py|go|cs|php|rb)$/;
for (const a of arquivos) if (NOMES_ENTRY.test(a.nome) && a.rel.split('/').length <= 4) r.entrypoints.push({ arquivo: a.rel, via: 'nome' });

// ---------- IaC / CI ----------
for (const a of arquivos) {
  if (a.ext === '.tf') { const t = ler(a); r.iac.push({ tipo: 'terraform', arquivo: a.rel, recursos: [...new Set([...t.matchAll(/resource\s+"([\w-]+)"\s+"([\w-]+)"/g)].map(m => `${m[1]}.${m[2]}`))].slice(0, 80) }); }
  else if (/^serverless\.ya?ml$/.test(a.nome)) { try { const d = YAML.parse(ler(a)) || {}; r.iac.push({ tipo: 'serverless', arquivo: a.rel, provider: d.provider?.name, funcoes: Object.keys(d.functions || {}) }); } catch {} }
  else if (/^(template|samconfig)\.ya?ml$/.test(a.nome) && ler(a).includes('AWS::')) r.iac.push({ tipo: 'cloudformation/sam', arquivo: a.rel, recursos: [...new Set([...ler(a).matchAll(/Type:\s*['"]?(AWS::[\w:]+)/g)].map(m => m[1]))] });
  else if ((a.ext === '.yml' || a.ext === '.yaml') && /^\s*kind:\s*(Deployment|Service|Ingress|StatefulSet|CronJob)/m.test(ler(a))) r.iac.push({ tipo: 'kubernetes', arquivo: a.rel, kinds: [...new Set([...ler(a).matchAll(/^\s*kind:\s*(\w+)/gm)].map(m => m[1]))] });
  if (a.rel.startsWith('.github/workflows/')) { const t = ler(a); r.ci.push({ tipo: 'github-actions', arquivo: a.rel, nome: (t.match(/^name:\s*(.+)$/m) || [])[1], gatilhos: (t.match(/^on:\s*([\s\S]*?)\n\w/m) || [])[1]?.split('\n').map(s => s.trim().replace(/:$/, '')).filter(Boolean).slice(0, 6) }); }
  if (a.nome === '.gitlab-ci.yml') r.ci.push({ tipo: 'gitlab-ci', arquivo: a.rel });
}

// ---------- env + hosts finais ----------
r.env = [...envMap.entries()].map(([k, s]) => ({ nome: k, origens: [...s].slice(0, 5) })).sort((x, y) => x.nome.localeCompare(y.nome));
const ehInterno = h => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || /\.(local|lan|internal|intranet|corp|home)(:\d+)?$/.test(h) || /^[^.]+(:\d+)?$/.test(h);
r.hosts = [...hostMap.entries()].map(([h, s]) => ({ host: h, interno: ehInterno(h), arquivos: [...s].slice(0, 5) })).sort((x, y) => x.host.localeCompare(y.host));

// ---------- tecnologias ----------
const nomesArquivos = arquivos.map(a => a.rel);
const imagensDocker = [...r.docker.compose.flatMap(c => (c.services || []).map(s => s.imagem).filter(Boolean)), ...r.docker.dockerfiles.flatMap(d => d.from)];
const tiposN8n = r.n8n.flatMap(w => w.nodes.map(n => n.tipo));
const envNomes = r.env.map(e => e.nome);
const norm = s => String(s).toLowerCase().replace(/_/g, '-');
for (const [chave, t] of Object.entries(techMap)) {
  const ev = []; const d = t.detect || {};
  for (const eco of ['npm', 'pypi', 'composer', 'gomod', 'maven', 'nuget', 'gem'])
    for (const p of d[eco] || []) { const hit = Object.keys(r.dependencias[eco]).find(k => norm(k) === norm(p) || (eco === 'maven' && k.includes(p))); if (hit) ev.push(`${eco}:${hit}${r.dependencias[eco][hit].dev ? ' (dev)' : ''}`); }
  for (const img of d.docker || []) { const hit = imagensDocker.find(i => i && i.toLowerCase().split('/').pop().split(':')[0].includes(img.toLowerCase()) || (i && i.toLowerCase().includes(img.toLowerCase() + ':'))); if (hit) ev.push(`docker:${hit}`); }
  for (const tp of d.n8n || []) { const hit = tiposN8n.find(x => x.toLowerCase().includes(tp.toLowerCase())); if (hit) ev.push(`n8n:${hit}`); }
  for (const e of d.env || []) { const hit = envNomes.find(x => x.toUpperCase().includes(e.toUpperCase())); if (hit) ev.push(`env:${hit}`); }
  for (const h of d.host || []) { const hit = r.hosts.find(x => x.host.includes(h)); if (hit) ev.push(`host:${hit.host}`); }
  for (const f of d.arquivo || []) {
    const hit = f.startsWith('*') ? nomesArquivos.find(n => n.toLowerCase().endsWith(f.slice(1).toLowerCase())) : nomesArquivos.find(n => n === f || n.endsWith('/' + f) || n.startsWith(f + '/'));
    if (hit) ev.push(`arquivo:${hit}`);
  }
  if (ev.length) {
    const soDev = ev.every(e => e.includes('(dev)'));
    r.tecnologias.push({ chave, nome: t.nome, categoria: t.categoria, papel: t.papel, camada: t.camada, evidencias: [...new Set(ev)].slice(0, 6), somenteDev: soDev || undefined });
  }
}

// ---------- módulos / subprojetos ----------
const porTopo = {};
for (const a of arquivos) {
  const topo = a.rel.includes('/') ? a.rel.split('/')[0] : '(raiz)';
  const m = porTopo[topo] ||= { pasta: topo, arquivos: 0, codigo: 0, exts: {} };
  m.arquivos++; if (EXT_CODIGO.has(a.ext)) { m.codigo++; m.exts[a.ext] = (m.exts[a.ext] || 0) + 1; }
}
r.modulos = Object.values(porTopo).sort((x, y) => y.codigo - x.codigo).map(m => ({ ...m, linguagemPrincipal: Object.entries(m.exts).sort((x, y) => y[1] - x[1])[0]?.[0] }));
r.subprojetos = [...new Set(r.manifestos.filter(m => m.tipo !== 'erro').map(m => path.posix.dirname(m.arquivo)))];

const nCod = Object.values(contExt).reduce((s, v) => s + v, 0);
const tamanho = nCod < 80 ? 'pequeno' : nCod < 400 ? 'medio' : 'grande';
r.resumo = {
  arquivos: arquivos.length, arquivosCodigo: nCod, linhasCodigo, porExtensao: contExt, tamanho,
  estrategiaSugerida: tamanho === 'grande' || r.subprojetos.length > 3
    ? 'subagentes: dividir a leitura por subprojeto/módulo (veja subprojetos e modulos)'
    : tamanho === 'medio' ? 'leitura dirigida: entrypoints, rotas, camadas de acesso a dados e integrações' : 'leitura direta dos arquivos de código',
  workflowsN8n: r.n8n.length, servicosDocker: r.docker.compose.reduce((s, c) => s + (c.services?.length || 0), 0)
};

const json = JSON.stringify(r, null, 2);
if (saida) { fs.mkdirSync(path.dirname(path.resolve(saida)), { recursive: true }); fs.writeFileSync(saida, json); }
else process.stdout.write(json + '\n');

// resumo legível
const tec = r.tecnologias.map(t => t.nome).join(', ');
process.stderr.write(`\n[scan] ${r.resumo.arquivos} arquivos, ${nCod} de código (${tamanho}). Subprojetos: ${r.subprojetos.length}. ` +
  `Docker: ${r.resumo.servicosDocker} serviço(s). n8n: ${r.n8n.length} workflow(s). Env: ${r.env.length} variável(is). ` +
  `Hosts externos: ${r.hosts.filter(h => !h.interno).length}. Rotas: ${r.rotas.length}.` + (r.segredosNoCodigo.length ? ` ATENÇÃO: ${r.segredosNoCodigo.length} possível(is) segredo(s) escrito(s) no código.` : '') + `\n[scan] Tecnologias: ${tec || '(nenhuma)'}\n` +
  (saida ? `[scan] Salvo em ${saida}\n` : ''));
