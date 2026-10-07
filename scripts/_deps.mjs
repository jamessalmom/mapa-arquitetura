// Carrega dependências do skill (instaladas em <skill>/node_modules). Na primeira execução,
// instala sozinho com npm a partir do package.json do skill.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(path.join(SKILL_DIR, 'package.json'));

let instalou = false;
export async function carregarDep(nome) {
  try { return req(nome); } catch (e) {
    if (instalou || !/Cannot find module/.test(String(e.message))) throw e;
    process.stderr.write(`[mapa-arquitetura] Instalando dependências do skill (primeira execução)...\n`);
    try {
      execSync('npm install --omit=dev --no-audit --no-fund --loglevel=error', { cwd: SKILL_DIR, stdio: ['ignore', 'ignore', 'inherit'] });
    } catch {
      throw new Error(`Falha ao instalar dependências. Rode manualmente: npm install --prefix "${SKILL_DIR}"`);
    }
    instalou = true;
    return req(nome);
  }
}

export function lerJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
