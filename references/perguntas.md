# Checkpoint com o usuário

Objetivo: corrigir o entendimento **antes** de desenhar e descobrir o que o código não mostra. Uma rodada só,
curta, com recomendação em cada pergunta, para o usuário poder responder "ok" e seguir.

## 1. "Entendi assim" (até 15 linhas)

```
**Entendi assim:** <nome> é <uma frase do que o sistema faz>.
- Partes: <container 1 (tec)>, <container 2 (tec)>, <banco>, <fila>...
- Integrações externas: <WhatsApp via Evolution API>, <Claude>, <Gmail>...
- Onde roda: <VPS com docker-compose> / <AWS> / <não identificado>
- Fluxos que vou desenhar: ① <fluxo principal> ② <fluxo 2>
- Divergências: <README cita Redis, mas nenhum código usa>
- Fora do desenho: <pasta legacy/>, <workflow n8n inativo "teste">
```

## 2. Perguntas (4 a 6)

Escolha do banco abaixo só as que **mudam o desenho** para este projeto. Cada uma com a opção recomendada
primeiro, marcada "(Recomendado)". Com `AskUserQuestion` disponível, use-o (até 4 por chamada; faça duas
chamadas se precisar); sem ele, texto numerado com a recomendação em cada item.

| Tema | Pergunte quando | Recomendação padrão |
|---|---|---|
| **Público** do diagrama (devs, cliente/gestor, apresentação, documentação do repo) | sempre | Devs/documentação: todas as visões. Cliente/gestor: contexto + containers + 1 fluxo, descrições em linguagem de negócio, `--escuro` só se for apresentação |
| **Fluxos** a destacar | sempre que houver mais de 2 candidatos | Os 2 que você escolheu, com o motivo |
| **Divergências e código morto** | houver pasta legacy, workflow inativo, dependência sem uso, README contraditório | Deixar fora do desenho e citar na entrega |
| **Integrações invisíveis no código** (configuradas em painel: webhooks de SaaS, crons do servidor, backups, CDN, DNS) | integração parece faltar uma ponta | Desenhar só o que existe no código, mais o que o usuário confirmar agora |
| **Onde roda** (servidor, nuvem, conta, rede do cliente) | o código não deixa claro o deploy | Grupo genérico "Ambiente de produção" |
| **Hosts reais ou mascarados** | o scan achou hosts internos ou domínios da empresa | Mascarar (`mascararHosts: true`) |
| **Nível de detalhe** dos componentes | algum container tem 8+ módulos relevantes | Componentes só dos 1 ou 2 containers centrais |
| **Nomes de negócio** | pastas com nomes técnicos ou siglas | Os nomes que você propôs, mostrados lado a lado com a pasta |

## Regras

- Não pergunte o que o código responde (linguagem, framework, banco usado, rotas).
- Não pergunte sobre estilo visual; a convenção é fixa (`references/estilo.md`). Exceção: tema escuro para apresentação.
- Uma pergunta = uma decisão. Nada de "mais alguma coisa?".
- Resposta "ok"/"pode seguir" = aceitar todas as recomendações.
- Sem ninguém para responder (execução agendada ou `--rapido`): siga as recomendações e liste na entrega quais
  suposições foram feitas.

## Modo atualização

O checkpoint mostra só o diff (`diff-mapa.mjs`): nós e conexões novos, removidos e alterados. Pergunte apenas
sobre o que mudou e sobre remoções (pode ter sido só uma falha de detecção).
