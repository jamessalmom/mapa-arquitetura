# Como reconhecer cada tipo de projeto

O `scan.mjs` entrega o inventário bruto. Este guia diz **onde olhar depois dele** para transformar inventário em
arquitetura: quais peças existem, como se falam e em que direção. Tudo que for para o mapa precisa de evidência
(arquivo e, se der, linha).

## Ordem de leitura (qualquer projeto)

1. `README`, `docs/` e `CLAUDE.md`/`AGENTS.md`, só como pista (o código manda).
2. Orquestração: `docker-compose*.yml`, `Procfile`, `Makefile`, `package.json` (scripts), CI (`.github/workflows`),
   IaC. Isso diz **quais processos existem e onde rodam** (nós e grupos).
3. Entrypoints de cada processo: `main`, `server`, `app`, `manage.py`, `wsgi/asgi`, `Program.cs`, `index.php`.
4. Borda de entrada: rotas HTTP, webhooks, consumidores de fila, crons, handlers de bot.
5. Borda de saída: clientes HTTP/SDK (o que cada um chama), acesso a dados (ORM, SQL cru), publicação em fila,
   envio de e-mail, upload para storage.
6. Configuração: nomes de variáveis em `scan.json → env` ligam código a serviços (`DATABASE_URL` → banco,
   `ANTHROPIC_API_KEY` → Claude, `EVOLUTION_URL` → Evolution API).

## Sinais por tecnologia

| Onde está | O que procurar | Vira |
|---|---|---|
| `docker-compose` | cada `service`; `depends_on`; portas publicadas; `image` (postgres, redis, n8n, nginx…) | nó por serviço; imagem de banco/cache/fila = nó de dados; nginx/traefik/caddy = `gateway` |
| `Dockerfile` | `FROM`, `EXPOSE`, `CMD` | runtime e porta do container |
| Python | `FastAPI()`, `Flask(__name__)`, Django `urls.py`, `celery`, `APScheduler`, `requests/httpx` | API, worker, job; cada `httpx`/SDK é conexão de saída |
| Node/TS | `express()`, `fastify`, Nest `@Controller`, Next `app/**/route.ts`, `bullmq`, `node-cron`, `axios/fetch` | idem |
| PHP | Laravel `routes/*.php`, `Jobs/`, `config/queue.php`; WordPress `functions.php`, plugins, `wp_remote_*` | idem; WordPress = `app` + banco MySQL |
| SQL/ETL | scripts `.sql`, `pyodbc`/`sqlalchemy`, `pandas.read_sql`, `to_sql`, Airflow DAGs, Glue jobs | `job` por pipeline; banco de origem → job → banco/arquivo de destino |
| n8n (`scan.json → n8n`) | nó gatilho (webhook/cron/trigger), nós HTTP Request (host), nós de app (WhatsApp, Gmail, Postgres, OpenAI/Anthropic, langchain) e `credenciais` | **cada workflow é um nó `workflow`**; cada app/credencial vira conexão para um nó externo; webhook de entrada = conexão assíncrona chegando no workflow |
| AWS (Terraform/CDK/SAM/serverless) | `aws_lambda_function`, `aws_s3_bucket`, `aws_sqs_queue`, API Gateway, Glue, Athena, RDS | nó por recurso relevante com ícone `aws-*`; conta/VPC = grupo |
| Front-end | `fetch`/`axios` para a própria API, `NEXT_PUBLIC_*`/`VITE_*` | `frontend` → `api` (HTTPS) |
| BI | `.pbix`/`.pbit` (só o nome), conexões em `.json` de datasets, Metabase/Superset no compose | nó de BI lendo o banco (`SQL · leitura`) |

## Como decidir uma conexão

- **Quem inicia?** Quem tem o cliente HTTP/SDK/produtor é o `de`. Webhook recebido: o serviço externo é o `de`.
- **Síncrono ou assíncrono?** Espera resposta para seguir = `sincrono`. Fila, evento, webhook, cron, e-mail = `assincrono`.
- **Ação concreta.** Use a rota ou operação real (`POST /webhook/whatsapp`, `messages.create`, `SELECT pedidos`,
  `publica pedido.criado`), resumida em até 32 caracteres.
- **Sem evidência, sem seta.** Se só o README cita uma integração, anote como dúvida para o checkpoint.

## Armadilhas comuns

- Dependência instalada mas nunca importada não é integração: confira o import/uso antes de desenhar.
- Pasta `legacy/`, `old/`, `bkp/`, código comentado e workflows n8n com `ativo: false`: pergunte se ainda vale.
- O mesmo banco usado por dois serviços é **um** nó com duas conexões, não dois bancos.
- `localhost` no código de um serviço dentro do compose geralmente aponta para outro serviço do compose:
  resolva pelo nome do serviço e pela porta.
- `scan.json → segredosNoCodigo` é um achado para a entrega (arquivo e tipo, nunca o valor).

## Projetos grandes: modelo de prompt para subagente

Divida por subprojeto/módulo (`scan.json → subprojetos` e `modulos`). Para cada parte, um subagente (no Claude
Code, tipo `Explore`, em paralelo) com este prompt, preenchendo os campos entre `<>`:

```
Você está mapeando a arquitetura do módulo <pasta> do projeto em <RAIZ>. Só leitura: não altere nada e não
abra .env, *.pem, credentials*.json ou similares. Contexto do projeto inteiro (resumo do scan):
<5 a 10 linhas: tecnologias, serviços docker, outros módulos e seus papéis>

Descubra neste módulo: (1) quais processos/serviços ele roda e como inicia; (2) componentes internos
relevantes (3 a 8, por responsabilidade, não por pasta); (3) toda comunicação de entrada e de saída: com quem,
protocolo, ação concreta (rota, operação, tópico), síncrona ou assíncrona, e quem inicia; (4) bancos, filas,
caches e storages que usa; (5) dúvidas que o código não resolve.

Responda SÓ com JSON neste formato, com evidência (arquivo:linha) em cada item:
{"nos":[{"id","nome","tipo","tecnologias":[],"descricao","pai","evidencias":[]}],
 "conexoes":[{"de","para","protocolo","acao","modo","evidencias":[]}],
 "duvidas":["..."]}
Para algo fora deste módulo, use um id descritivo (ex.: "banco-principal", "claude") e eu concilio.
```

Ao consolidar: una ids que são a mesma coisa, mantenha a evidência mais forte e leve as `duvidas` para o
checkpoint.
