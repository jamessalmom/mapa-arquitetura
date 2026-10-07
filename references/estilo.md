# Convenção visual

A aparência é fixa e aplicada pelo `build-drawio.mjs`. Seu trabalho é dar ao build um mapa que caiba bem nessa
convenção. Este arquivo explica as regras (para montar o mapa) e traz o checklist da checagem visual.

## Visões (estilo C4)

| Visão | Mostra | Tamanho bom |
|---|---|---|
| `contexto` | o sistema como um card único, pessoas e serviços externos | até 10 nós |
| `containers` | cada processo/serviço, bancos, filas, externos, dentro dos grupos de deploy | até 16 nós; acima disso, divida em duas visões de containers por área ou agrupe externos parecidos |
| `componentes:<id>` | partes internas de um container + vizinhos diretos (esmaecidos) | 3 a 10 componentes |
| `fluxo:<id>` | um caminho crítico, passos numerados ①②③ | 4 a 10 passos |

Cada página tem cabeçalho (projeto, visão, data, versão) e legenda com as camadas usadas e os tipos de seta.

## Cor = camada

| Camada | Cor da borda (tema claro) | Tipos que caem nela |
|---|---|---|
| Pessoas | cinza-ardósia | `pessoa` |
| Cliente / front-end | azul | `frontend`, `app`, `mobile` |
| Infraestrutura / borda | vermelho | `gateway`, `infra` |
| Aplicação / backend | verde | `api`, `servico`, `worker`, `job`, `workflow`, `componente` |
| Mensageria / filas | roxo | `fila`, `topico` |
| Dados / armazenamento | âmbar | `banco`, `cache`, `storage` |
| Serviços externos | cinza | `externo` |

Não invente cores nem use cor para significar outra coisa. Grupo (caixa tracejada) = **onde roda**, nunca camada.

## Setas

- **Sólida** = síncrona (`modo: sincrono`); **tracejada** = assíncrona (webhook, fila, evento, cron, e-mail).
- Rótulo `protocolo · ação`, curto. Sem rótulo, a seta não diz nada; o validador acusa.
- Direção de quem inicia. Nunca seta de duas pontas.
- Nas visões de containers e contexto, conexões de componentes sobem para o container e repetidas se juntam.

## Cards

- Logo grande à esquerda = 1ª tecnologia; até 2 logos pequenos = 2ª e 3ª.
- Nome de função ("API de atendimento"), linha `[Tipo: tecnologias]` e descrição do **papel** (≤ 110 caracteres).
- Tecnologia sem logo vira badge com iniciais; prefira uma chave do `tech-map.json` ou um `icone` explícito.

## Checklist da checagem visual (olhe cada PNG)

1. Algum texto cortado ou saindo do card? → encurte `nome`/`descricao`.
2. Rótulo de seta longe da própria seta, ou em cima de outro rótulo? → encurte `acao`; junte conexões repetidas.
3. Cards ou grupos sobrepostos? → revise `grupo`/`pai` (nó em grupo errado costuma causar isso).
4. Seta atravessando um card? → teste `projeto.direcao` `RIGHT`/`DOWN`; divida a visão.
5. Página grande demais para ler em tela cheia? → divida a visão ou reduza nós (agrupe externos semelhantes).
6. Algum card sem logo que deveria ter? → acerte a chave da tecnologia.
7. A história faz sentido lendo só o diagrama, sem o código? Se não, falta nó, seta ou descrição.

Máximo de 3 rodadas de correção. O que sobrar vai como observação na entrega.
