#!/usr/bin/env node
// Exporta cada página do .drawio para PNG (para conferência visual) e SVG (para documentação),
// usando o draw.io desktop em modo CLI. No Linux sem tela, usa xvfb-run automaticamente.
// Uso: node export.mjs <arquivo.drawio> [--saida <pasta>] [--formatos png,svg] [--escala 1.5]
// Saída 2 = draw.io não encontrado (o .drawio continua válido; só não há imagens).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const arq = args.find(a => !a.startsWith('--') && !['--saida', '--formatos', '--escala'].includes(args[args.indexOf(a) - 1]));
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
if (!arq) { console.error('Uso: node export.mjs <arquivo.drawio> [--saida pasta] [--formatos png,svg]'); process.exit(1); }
const saida = path.resolve(opt('--saida', path.join(path.dirname(arq), 'imagens')));
const formatos = opt('--formatos', 'png,svg').split(',');
const escala = opt('--escala', '1.5');

function existe(cmd) { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }); return true; } catch { return false; } }
function acharDrawio() {
  if (process.env.DRAWIO_BIN && fs.existsSync(process.env.DRAWIO_BIN)) return [process.env.DRAWIO_BIN];
  for (const c of ['drawio', 'draw.io']) if (existe(c)) return [c];
  const fixos = ['/opt/drawio/drawio', '/opt/draw.io/drawio', '/usr/bin/drawio', '/snap/bin/drawio',
    '/Applications/draw.io.app/Contents/MacOS/draw.io', path.join(os.homedir(), 'Applications/draw.io.app/Contents/MacOS/draw.io'),
    'C:\\Program Files\\draw.io\\draw.io.exe', path.join(os.homedir(), 'AppData\\Local\\Programs\\draw.io\\draw.io.exe')];
  for (const f of fixos) if (fs.existsSync(f)) return [f];
  for (const d of [path.join(os.homedir(), 'Applications'), path.join(os.homedir(), 'Downloads'), path.join(os.homedir(), '.local/bin')]) {
    try { const ap = fs.readdirSync(d).find(n => /^drawio.*\.AppImage$/i.test(n)); if (ap) return [path.join(d, ap), '--appimage-extract-and-run']; } catch {}
  }
  if (existe('flatpak')) { const r = spawnSync('flatpak', ['info', 'com.jgraph.drawio.desktop'], { stdio: 'ignore' }); if (r.status === 0) return ['flatpak', 'run', 'com.jgraph.drawio.desktop']; }
  return null;
}

const bin = acharDrawio();
if (!bin) {
  console.error(`[export] draw.io desktop não encontrado. Instale para gerar PNG/SVG:
  Linux:   flatpak install flathub com.jgraph.drawio.desktop   (ou o .deb/.AppImage em github.com/jgraph/drawio-desktop/releases)
  macOS:   brew install --cask drawio
  Windows: winget install JGraph.Draw
  Ou defina DRAWIO_BIN com o caminho do executável. O arquivo .drawio já está pronto e abre no app ou em app.diagrams.net.`);
  process.exit(2);
}

const xml = fs.readFileSync(arq, 'utf8');
const paginas = [...xml.matchAll(/<diagram\s+name="([^"]*)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
fs.mkdirSync(saida, { recursive: true });
const semTela = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const prefixo = semTela && existe('xvfb-run') ? ['xvfb-run', '-a'] : [];
if (semTela && !prefixo.length) console.error('[export] Aviso: sem DISPLAY e sem xvfb-run; o draw.io pode falhar. Instale xvfb (apt install xvfb).');
const extras = ['--no-sandbox'];
const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const gerados = [];
paginas.forEach((nome, i) => {
  for (const f of formatos) {
    const out = path.join(saida, `${String(i + 1).padStart(2, '0')}-${slug(nome)}.${f}`);
    const cmd = [...prefixo, ...bin, ...extras, '-x', '-f', f, '-p', String(i + 1), '-b', '24', ...(f === 'png' ? ['-s', escala] : ['--embed-svg-images']), '-o', out, path.resolve(arq)];
    const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf8', timeout: 120000 });
    if (fs.existsSync(out) && fs.statSync(out).size > 0) gerados.push(out);
    else console.error(`[export] Falhou: página ${i + 1} (${nome}) em ${f}. ${String(r.stderr || '').split('\n').filter(l => !/dbus|GPU|viz_main|gpu_init/i.test(l)).slice(-3).join(' ')}`);
  }
});
console.log(`[export] ${gerados.length} arquivo(s) em ${saida}`);
for (const g of gerados) console.log('  ' + g);
process.exit(gerados.length ? 0 : 3);
