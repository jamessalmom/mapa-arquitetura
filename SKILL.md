---
name: mapa-arquitetura
description: Lê um projeto inteiro (código, configs, Docker, IaC, CI e workflows n8n), entende como as partes funcionam e se comunicam, faz ao usuário as perguntas que o código não responde e gera um fluxograma técnico profissional em draw.io — visões estilo C4 (contexto, containers, componentes, fluxos), logos reais das tecnologias dentro dos nós, setas com protocolo e ação, legenda — além de PNG/SVG, um HTML interativo idêntico ao diagrama (clique em cada peça para ver detalhes) e inventário da stack. Use sempre que o usuário pedir diagrama de arquitetura, fluxograma do projeto/sistema, mapa técnico, "documenta a arquitetura", "como as partes se conectam", visão geral técnica, diagrama C4 ou de integrações, ou quiser atualizar um diagrama gerado antes — mesmo que não diga "draw.io" nem "skill".
---

# Mapa de arquitetura

Produz, a partir do código real, um diagrama de arquitetura que um arquiteto apresentaria: correto, legível e
editável. O trabalho pesado e determinístico (varredura, ícones, layout, validação, export) fica nos scripts;
o seu trabalho é **entender o projeto** e **montar o mapa** (`mapa.json`) com fidelidade.

## Regras inegociáveis

1. **Nada inventado.** Todo nó e toda conexão do mapa precisam de evidência no projeto (arquivo:linha ou
   configuração) ou de confirmação explícita do usuário. Na dúvida, pergunte no checkpoint; não desenhe.
2. **Segredos nunca.** Não abra `.env`, `*.pem`, `credentials*.json` nem similares. O `scan.mjs` já extrai
   só os NOMES das variáveis. Nenhum valor de token, senha, chave ou URL com credencial entra em qualquer saída.
   Hosts internos e IPs ficam mascarados (`mascararHosts: true`) salvo autorização do usuário.
3. **Não altere o projeto.** Só escreva dentro da pasta de saída (padrão `docs/arquitetura/`). Nada de
   instalar dependências do projeto, rodar build dele ou editar código.
4. **O código manda.** README, comentários e docs antigos são pistas; se contradizem o código, vale o código
   (e mencione a divergência no checkpoint).

## Caminhos

- `SKILL_DIR` = pasta deste arquivo. Scripts em `SKILL_DIR/scripts/` (Node ≥ 18; instalam as próprias
  dependências na primeira execução).
- `RAIZ` = raiz do projeto (o diretório de trabalho atual, salvo indicação).
- `OUT` = `RAIZ/docs/arquitetura` (ou `--saida`). Arquivos intermediários vão em `OUT/.trabalho/`.

**Argumentos** (`$ARGUMENTS` no Claude Code): texto livre = foco (gera só a visão pedida, ex.: um fluxo);
`--rapido` = pula o checkpoint e usa as recomendações; `--escuro` = tema escuro; `--saida <pasta>`.

## Fluxo de trabalho

Crie uma lista de tarefas com as 6 fases e vá marcando. Se `OUT/mapa.json` já existe, é **modo atualização**
(veja a seção própria) — avise o usuário em uma linha.

### 1. Reconhecimento

```bash
node "$SKILL_DIR/scripts/scan.mjs" "$RAIZ" --saida "$OUT/.trabalho/scan.json"
```

Leia o resumo impresso e o `scan.json` (tecnologias com evidências, serviços docker, workflows n8n, env,
hosts externos, rotas, entrypoints, IaC, CI, módulos/subprojetos). Depois leia `references/deteccao.md` e
aprofunde conforme `resumo.estrategiaSugerida`:

- **pequeno**: leia os arquivos de código diretamente.
- **médio**: leitura dirigida — entrypoints, rotas/handlers, camada de dados, clientes de integração, jobs,
  configs de deploy.
- **grande ou monorepo**: divida por subprojeto/módulo e use **subagentes em paralelo** (no Claude Code, o
  tipo `Explore`), com o modelo de prompt de `references/deteccao.md`. Cada um devolve um mapa parcial em
  JSON; você consolida. Sem subagentes disponíveis, faça a mesma divisão em sequência.

### 2. Mapa

Monte `OUT/mapa.json` seguindo **`references/schema-mapa.md`** (leia antes de escrever) e as regras de
`references/estilo.md`:

- vira **nó**: aplicações, serviços, workers, workflows, bancos, caches, filas, storage, gateways, cada
  serviço externo, pessoas/atores;
- vira **etiqueta** (`tecnologias` do nó): linguagem, framework, runtime, bibliotecas que definem a
  arquitetura (ORM, SDK de fila, cliente de LLM). Use as chaves de `assets/tech-map.json`;
- **fica de fora**: bibliotecas utilitárias, dev-dependencies, testes (vão para o inventário);
- toda conexão tem `protocolo`, `acao` e `modo` (`sincrono` | `assincrono`), na direção de quem **inicia**;
  ida e volta = duas conexões;
- escolha 2 a 3 **fluxos** críticos (o caminho que dá dinheiro, o que mais falha, o que o usuário citou);
- `visoes`: `contexto` e `containers` sempre; `componentes:<id>` para cada container com 3+ módulos
  relevantes; `fluxo:<id>` para cada fluxo. Projeto pequeno pode ter só contexto + containers + 1 fluxo.

### 3. Checkpoint com o usuário (obrigatório, salvo `--rapido`)

Antes de desenhar, mostre o que entendeu e faça as perguntas que o código não responde. Siga
**`references/perguntas.md`**: um resumo "Entendi assim" de até 15 linhas (partes, integrações, fluxos
escolhidos, divergências e dúvidas) + **4 a 6 perguntas, cada uma com a resposta recomendada**. Use a
ferramenta de perguntas de múltipla escolha se existir (ex.: `AskUserQuestion`); senão, texto numerado.
Espere as respostas e aplique no mapa. Se ninguém estiver respondendo (execução agendada), siga as
recomendações e registre isso na entrega.

### 4. Geração

```bash
node "$SKILL_DIR/scripts/build-drawio.mjs" "$OUT/mapa.json" "$OUT/arquitetura.drawio" [--mermaid "$OUT/arquitetura.mmd"]
node "$SKILL_DIR/scripts/inventario.mjs" "$OUT/.trabalho/scan.json" "$OUT/mapa.json" "$OUT/stack.md"
```

`--mermaid` só se o usuário quiser um diagrama simplificado para README. Erros do build apontam o
problema no mapa (id inexistente, visão inválida); corrija o mapa e rode de novo — o build não grava nada
se alguma visão falhar.

### 5. Validação (nada é entregue sem passar)

```bash
node "$SKILL_DIR/scripts/validate.mjs" "$OUT"
node "$SKILL_DIR/scripts/export.mjs" "$OUT/arquitetura.drawio" --saida "$OUT/imagens"
```

1. `validate.mjs` saindo com erro → corrija e gere de novo. Avisos: resolva os que forem fáceis
   (descrição longa, nó órfão, falta de tecnologia).
2. **Checagem visual:** abra cada PNG de `OUT/imagens/` com a ferramenta de leitura de imagens e confira o
   checklist de `references/estilo.md` (texto cortado, rótulo longe da seta, cards sobrepostos, setas
   atravessando cards, página ilegível de tão grande). Corrija pelo mapa — encurtar rótulos e descrições,
   ajustar grupos, dividir uma visão grande, fixar `projeto.direcao` — e gere de novo. No máximo 3 rodadas;
   o que sobrar vira observação na entrega.
3. `export.mjs` saindo com código 2 = draw.io desktop não instalado. Diga ao usuário como instalar (a
   mensagem do script traz o comando por sistema), entregue o `.drawio` assim mesmo e deixe claro que a
   checagem visual não foi feita.
4. Com o diagrama aprovado na checagem visual, gere o HTML e valide de novo (o validador também procura
   segredos no HTML e acusa HTML mais antigo que o `.drawio`):

   ```bash
   node "$SKILL_DIR/scripts/html.mjs" "$OUT"
   node "$SKILL_DIR/scripts/validate.mjs" "$OUT"
   ```

   O `arquitetura.html` é um arquivo único que mostra cada página **exatamente** como a imagem (usa o SVG
   exportado pelo draw.io) e acrescenta: abas por visão, zoom e arrasto, clique em nó/seta/grupo para ver
   tecnologias, conexões, protocolos e evidências (arquivo:linha), busca e links diretos para um item.
   Funciona offline. Sem os SVGs (draw.io ausente), o script cai no modo `viewer`: mesmo visual, renderizado
   pelo visualizador oficial do draw.io, mas **precisa de internet** ao abrir; avise o usuário. Saída 4 =
   SVGs desatualizados: rode `export.mjs` antes.

### 6. Entrega

- Garanta `OUT/.trabalho/.gitignore` com `*` (scan e relatórios não vão para o git).
- Resposta curta: o que foi gerado (`arquitetura.html` para ver e compartilhar, `arquitetura.drawio` com N
  páginas para editar, `imagens/`, `stack.md`, `mapa.json`), 3 a 5 achados relevantes sobre a arquitetura (ex.: ponto único de falha, integração sem
  retry, segredo hardcoded detectado pelo scan — sem mostrar o valor), o que ficou de fora ou ficou como
  suposição, e **um** próximo passo natural.
- Como abrir: `arquitetura.html` em qualquer navegador (duplo clique). O `.drawio` no app draw.io desktop,
  na extensão "Draw.io Integration" do VS Code ou em app.diagrams.net.

## Modo atualização

Quando `OUT/mapa.json` já existe:

1. Copie `mapa.json` → `.trabalho/mapa.anterior.json` e `arquitetura.drawio` → `.trabalho/arquitetura.anterior.drawio`.
2. Rode o scan de novo e atualize o mapa **a partir do anterior** (mantenha ids, nomes e descrições que
   continuam valendo — ids estáveis são o que permite preservar o trabalho manual).
3. `node "$SKILL_DIR/scripts/diff-mapa.mjs" .trabalho/mapa.anterior.json mapa.json` → o checkpoint mostra
   **só o que mudou** e pergunta só sobre isso.
4. Gere com `--preservar "$OUT/.trabalho/arquitetura.anterior.drawio"` (depois exporte e gere o HTML de novo, como na fase 5): páginas cujo conteúdo não mudou são
   mantidas **exatamente como estavam** (inclusive ajustes feitos à mão no draw.io); páginas que mudaram
   são regeradas, com o que é novo marcado como **NOVO**. Diga ao usuário quais páginas foram regeradas e
   que a versão anterior está em `.trabalho/` caso ele queira reaplicar algum ajuste manual.

## Em outros agentes (Codex, Gemini CLI, Copilot)

Os scripts e as referências funcionam em qualquer agente que rode Node. Sem subagentes, faça a leitura por
módulos em sequência; sem ferramenta de perguntas, use texto numerado. O resultado esperado é o mesmo.
