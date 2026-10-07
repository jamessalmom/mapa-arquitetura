# Formato do `mapa.json`

O mapa é a fonte única do diagrama. O build gera todas as páginas a partir dele; o validador confere as regras
abaixo. Escreva em PT-BR; nomes de tecnologia e protocolo ficam no original.

## Estrutura

```json
{
  "projeto": {
    "nome": "AtendeBot",
    "descricao": "Uma frase sobre o que o sistema faz (aparece no card do sistema na visão de contexto)",
    "versao": "1.0",
    "tema": "claro",
    "mascararHosts": true,
    "hostsPrivados": ["erp.minhaempresa.com.br"],
    "direcao": null,
    "tecnologiasPrincipais": ["python", "fastapi"]
  },
  "grupos": [
    { "id": "vps", "nome": "VPS de produção", "tipo": "servidor" },
    { "id": "compose", "nome": "docker-compose", "tipo": "Docker", "pai": "vps" }
  ],
  "nos": [
    { "id": "api", "nome": "API de atendimento", "tipo": "api", "tecnologias": ["fastapi", "python"],
      "descricao": "Recebe webhooks do WhatsApp, consulta a IA e responde", "grupo": "compose",
      "evidencias": ["api/app/main.py", "docker-compose.yml:9"] },
    { "id": "api.ia", "nome": "Serviço de IA", "tipo": "componente", "pai": "api", "tecnologias": ["anthropic"],
      "descricao": "Monta o contexto e chama o Claude" }
  ],
  "conexoes": [
    { "de": "api.ia", "para": "claude", "protocolo": "HTTPS", "acao": "messages.create", "modo": "sincrono",
      "evidencias": ["api/app/services/ia.py:8"] }
  ],
  "fluxos": [
    { "id": "atendimento", "nome": "Mensagem recebida e respondida", "descricao": "Uma linha",
      "passos": [ { "de": "cliente", "para": "whatsapp", "protocolo": "WhatsApp", "acao": "envia mensagem", "modo": "assincrono" } ] }
  ],
  "visoes": ["contexto", "containers", "componentes:api", "fluxo:atendimento"]
}
```

## Campos

### `projeto`
| Campo | Obrigatório | Notas |
|---|---|---|
| `nome` | sim | Aparece no cabeçalho de todas as páginas e no card do sistema |
| `descricao` | recomendado | ≤ 140 caracteres |
| `versao` | não | Vai para o cabeçalho (`v1.0`) |
| `tema` | não | `claro` (padrão) ou `escuro` |
| `mascararHosts` | não | `true` (padrão) mascara IPs e hosts `.local/.lan/.internal/.corp` nos rótulos |
| `hostsPrivados` | não | Domínios extras a mascarar (ex.: domínio interno da empresa) |
| `direcao` | não | `RIGHT` ou `DOWN` força a direção em todas as páginas. Sem ele, o build escolhe por página |
| `tecnologiasPrincipais` | não | Logos do card do sistema na visão de contexto (padrão: as 3 mais usadas) |

### `grupos` — fronteiras de deploy (onde roda)
`id`, `nome`, `tipo` (texto curto exibido entre colchetes: `servidor`, `Docker`, `VPC`, `conta AWS`,
`Kubernetes`, `SaaS`, `rede local`...), `pai` (grupo dentro de grupo). Use grupos para **onde roda**, nunca
para camada lógica (a cor já mostra a camada). Não crie grupo com um nó só, salvo se a fronteira for
importante (ex.: "rede do cliente").

### `nos`
| Campo | Notas |
|---|---|
| `id` | Estável entre execuções (é o que permite preservar ajustes manuais). Minúsculo, sem espaço. Componentes: `container.parte` |
| `nome` | Nome de negócio/função, não nome de pasta: "API de atendimento", não "api" |
| `tipo` | `pessoa`, `frontend`, `app`, `mobile`, `api`, `servico`, `worker`, `job`, `workflow`, `gateway`, `banco`, `cache`, `fila`, `topico`, `storage`, `infra`, `externo`, `componente` |
| `camada` | Opcional; deduzida do tipo. Valores: `pessoa`, `cliente`, `infra`, `aplicacao`, `mensageria`, `dados`, `externo`. Defina à mão só quando a dedução erra (ex.: componente que é armazenamento → `dados`) |
| `tecnologias` | Chaves de `assets/tech-map.json`, da mais importante para a menos (a 1ª vira o logo grande; a 2ª e a 3ª, logos pequenos). Chave desconhecida também funciona: o build tenta achar o logo pelo nome |
| `icone` | Opcional, sobrepõe o 1º logo: `{"devicon": "markdown"}`, `{"si": "slug"}`, `{"drawio": "aws4:lambda:compute"}`, `{"url": "https://…svg"}` ou `{"arquivo": "caminho/logo.png"}` |
| `descricao` | ≤ 110 caracteres, o **papel** da peça ("Lista conversas e status"), não a tecnologia |
| `grupo` | id de grupo (só nós que não são componentes) |
| `pai` | Para `tipo: componente`: id do container ao qual pertence |
| `evidencias` | Arquivos (e linha, quando der) que provam a existência. Não aparece no desenho, serve para auditoria |
| `isolado` | `true` quando o nó não tem conexões de propósito (explique na descrição) |

### `conexoes`
`de`, `para` (ids de nós; podem ser componentes — nas visões de containers e contexto o build sobe a
conexão para o container/sistema e junta as repetidas), `protocolo`, `acao`, `modo` (`sincrono` |
`assincrono`), `evidencias`, `descricao` (opcional).

- **Direção = quem inicia.** Webhook do Stripe para a API: `de: stripe, para: api`. A resposta HTTP não vira seta.
- **Protocolo** curto e técnico: `HTTPS`, `HTTP/REST`, `gRPC`, `GraphQL`, `SQL`, `RESP` (Redis), `AMQP`,
  `Kafka`, `SMTP`, `SSH`, `WebSocket`, `S3 API`, `arquivo`, `chamada` (in-process), `WhatsApp`, `OAuth2`.
- **Ação** = o que acontece, ≤ 32 caracteres: `POST /webhook/whatsapp`, `SQL · leitura`, `publica pedido.criado`.
- **Modo assíncrono**: webhook, fila, evento, cron, e-mail, mensagem em canal. Síncrono: quem chama espera a resposta.
- Duas setas entre o mesmo par só se forem coisas diferentes (ex.: lê e publica).

### `fluxos`
2 a 3 caminhos críticos, cada um com `passos` em ordem (mesmos campos de uma conexão). O desenho numera os
passos ①②③. Um fluxo bom tem de 4 a 10 passos e conta uma história completa (gatilho → resultado).

### `visoes`
Lista ordenada de páginas: `contexto`, `containers`, `componentes:<id-do-container>`, `fluxo:<id-do-fluxo>`.
Sem `visoes`, o build usa contexto + containers + componentes de quem tem filhos + todos os fluxos.

## Chaves de tecnologia

Consulte `assets/tech-map.json` (campo `nome` mostra como aparece no desenho). Algumas úteis:
linguagens (`python`, `typescript`, `javascript`, `php`, `java`, `csharp`, `go`), frameworks (`fastapi`,
`django`, `flask`, `express`, `nestjs`, `nextjs`, `react`, `vue`, `laravel`, `wordpress`), dados
(`postgresql`, `mysql`, `sqlserver`, `mongodb`, `redis`, `sqlite`), AWS com ícone oficial (`aws-s3`,
`aws-lambda`, `aws-rds`, `aws-sqs`, `aws-glue`, `aws-athena`...), IA (`anthropic`, `openai`, `gemini`),
canais (`whatsapp`, `evolution-api`, `telegram`), automação (`n8n`), BI (`power-bi`, `metabase`).
Tecnologia sem logo conhecido aparece como **badge** com as iniciais — aceitável; o validador avisa.
