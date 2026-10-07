# Mapa de Arquitetura

Skill para analisar um projeto a partir do código e gerar uma documentação visual da arquitetura. O resultado inclui um diagrama editável no draw.io, uma versão HTML interativa e um inventário da stack.

## O que ela faz

A skill examina arquivos de código e configuração para identificar aplicações, serviços, bancos de dados, filas, integrações e fluxos importantes. Com base nas evidências encontradas, monta diferentes visões da arquitetura, como contexto, containers, componentes e fluxos. Também registra de onde veio cada informação, para que o diagrama possa ser conferido e atualizado depois.

Ela não deve alterar o projeto analisado. Os arquivos gerados ficam, por padrão, em `docs/arquitetura/`.

## Usar no Manus

1. Adicione a skill ao Manus usando a pasta deste repositório ou o arquivo `SKILL.md`, conforme a opção de importação disponível na sua interface.
2. Abra ou indique o projeto que deseja documentar.
3. Peça algo como: “Faça um mapa da arquitetura deste projeto, com foco no fluxo de pagamentos”. Também é possível pedir um diagrama C4, um mapa técnico ou uma atualização do diagrama existente.
4. Revise o resumo e responda às perguntas da etapa de confirmação. Elas servem para esclarecer pontos que não podem ser deduzidos com segurança apenas pelo código.
5. Quando a geração terminar, consulte `docs/arquitetura/arquitetura.html` no navegador e abra `docs/arquitetura/arquitetura.drawio` no draw.io para editar o diagrama.

A opção `--rapido` pula as perguntas e usa as recomendações da skill. Use-a apenas quando estiver confortável com essas suposições. Também é possível solicitar um tema escuro com `--escuro`, definir outra pasta com `--saida pasta` ou informar um foco, como `fluxo de autenticação`.

## Usar com outros agentes ou diretamente no terminal

A skill também pode orientar agentes que leem arquivos e executam comandos, como Codex, Gemini CLI ou Copilot. Coloque a pasta completa `mapa-arquitetura` em um local acessível ao agente e peça que ele siga o `SKILL.md`. É necessário manter junto dela as pastas `scripts`, `references` e `assets`; não copie apenas o arquivo principal.

Os scripts precisam do Node.js 18 ou superior. Para preparar as dependências, entre na pasta da skill e execute:

```bash
npm install
```

Na primeira execução, alguns scripts também podem preparar as dependências automaticamente. A partir da raiz do projeto que será analisado, o fluxo básico é:

```bash
export SKILL_DIR="/caminho/para/mapa-arquitetura"
export RAIZ="$PWD"
export OUT="$RAIZ/docs/arquitetura"
mkdir -p "$OUT/.trabalho"

node "$SKILL_DIR/scripts/scan.mjs" "$RAIZ" --saida "$OUT/.trabalho/scan.json"
```

Depois da varredura, o agente deve ler as instruções em `SKILL.md` e as referências indicadas por elas, preparar `mapa.json` de acordo com `references/schema-mapa.md`, conversar com você sobre as dúvidas e só então gerar e validar os arquivos. As etapas de geração, validação e exportação estão descritas no próprio `SKILL.md`; executar apenas a varredura não produz o diagrama completo.

## Arquivos gerados

- `arquitetura.html`: visualização interativa para abrir no navegador.
- `arquitetura.drawio`: diagrama editável.
- `imagens/`: exportações visuais, quando o draw.io Desktop estiver instalado.
- `mapa.json`: dados estruturados usados para montar o diagrama.
- `stack.md`: resumo das tecnologias identificadas.
- `.trabalho/`: arquivos intermediários da análise. O conteúdo deve permanecer fora do Git do projeto analisado.

## Cuidados e limites

A skill foi projetada para não abrir arquivos de segredos, como `.env`, chaves privadas ou arquivos de credenciais. O scanner procura nomes de variáveis sem expor seus valores, e tenta mascarar hosts internos e IPs. Ainda assim, revise os resultados antes de compartilhá-los, sobretudo se o projeto contiver informações confidenciais.

O mapa deve se apoiar em evidências do código ou em respostas suas. Quando uma conexão ou comportamento não estiver claro, a skill deve perguntar em vez de inventar. O diagrama não substitui uma revisão técnica do projeto.

O HTML funciona sem instalação adicional quando os recursos exportados estão disponíveis. Se o draw.io Desktop não estiver instalado, a versão HTML pode usar o visualizador oficial on-line e, nesse caso, precisa de conexão com a internet. O arquivo `.drawio` continua disponível para edição.

## Estrutura do repositório

`SKILL.md` contém o fluxo principal. `scripts/` reúne as ferramentas de varredura, construção, validação e exportação. `references/` guarda orientações e formatos de referência. `assets/tech-map.json` relaciona tecnologias a ícones e metadados usados no diagrama.
