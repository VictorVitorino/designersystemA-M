# Canteiro online — plataforma de criação de apresentações

Versão online do editor **Canteiro** (Alvarez & Marsal): cada pessoa entra com convite, cria apresentações, salva na nuvem com confirmação,
continua em outro computador, e todo o acervo fica visível para a equipe. **Só o dono altera a própria apresentação; quem quer usar a de
outra pessoa cria uma cópia.** Um administrador convida e gerencia; os demais são membros.

O editor em si (`../studio/`) **não foi alterado**: a versão em nuvem é o mesmo editor com uma extensão acrescentada no build e **seis ajustes de texto de uma linha**, verificados (cada um precisa existir exatamente uma vez no fonte, senão o build falha; `studio-cloud/patches.json`).
A prova disso está em [`docs/evidencias/paridade.md`](docs/evidencias/paridade.md) (todos os efeitos, modelos, layouts e quadros de animação comparados pixel a pixel com o original).

## Comece em um comando (local)

```bash
cd platform
npm ci
APP_ENV=local node tools/dev.js --admin voce@empresa.com --name "Seu Nome"
```

Sobe o Postgres local, aplica as migrações, um GoTrue falso (login sem Supabase), o site e a API em `http://localhost:3000`, e imprime o link para você definir a senha do primeiro administrador.
Tudo o que é de produção (Supabase, Vercel, domínio, e-mail) está em [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md), passo a passo.

## Mapa do repositório

| Pasta | O que é |
|---|---|
| `src/` | API (Hono): `app.js` compõe middlewares e rotas; `routes/` (auth, admin, presentations, comments, interactions, assets, health); `auth/` (GoTrue, JWT, cookies, senha); `lib/` (canônico/hash, lint de deck, validação de upload, cursor, CSV); `storage/` (local e S3); `static.js` (site com CSP por página) |
| `db/migrations/` | Esquema `app` com RLS em todas as tabelas, papéis de privilégio mínimo, funções de auditoria/limite/identidade |
| `web/` | Páginas do site (entrar, confirmar convite, esqueci a senha, acervo, admin, importar) sob CSP estrita |
| `studio-cloud/` | Extensão de nuvem do editor (`ed-50-cloud.js`), `cloud-core.js` e os patches de texto do build |
| `tools/` | `dev.js` (tudo em um comando), `migrate.js`, `build-web.js`/`build-cloud-editor.js`/`csp.js`, `backup.js`/`restore.js`/`restore-drill.js`, `gc-assets.js`, `maintenance.js`, `verify-deploy.js`, `secret-scan.js`, `parity.cjs` (prova de paridade) e `parity-evidence.cjs` (gera `docs/evidencias/paridade.md` a partir do relatório), `fake-gotrue.js`, `create-first-admin.js`, `seed-demo.js` |
| `tests/` | `unit`, `db` (isolamento/RLS), `api`, `security`, `web` (Playwright), `cloud` (editor em nuvem + preservação), `ops` (backup/restore/GC), `e2e` (pilha real), `load` (50 usuários) |
| `infra/` | Supabase (checklist do painel, templates de e-mail, SSO), Vercel, Docker/Caddy alternativo, exemplos de variáveis |
| `docs/` | Contrato da API, arquitetura, segurança, operação, backup, monitoramento, ambientes, pesquisa de custos, evidências |
| `api/index.js` | Entrada da Vercel (todas as rotas `/api/*`) |

## Comandos

```bash
npm test                 # unit + banco + API (Postgres local)
npm run test:security    # suíte ofensiva, CSRF, cabeçalhos, sessões e limites
npm run test:e2e         # ponta a ponta com a pilha real (Playwright)
npm run test:load        # 50 usuários simultâneos
npm run test:parity      # prova de paridade original × editor em nuvem (≈ 1 h); depois: npm run test:parity:evidence
npm run build:web        # dist/public + csp.json + vercel.json
npm run build:cloud      # editor em nuvem (e prova que o autônomo segue byte-idêntico)
node tools/backup.js all # backup cifrado do banco e dos arquivos (ver docs/BACKUP-E-RESTAURACAO.md)
```

## Regras do produto (resumo)

1. Acervo comum: toda apresentação salva é visível (somente leitura) para todos os usuários ativos.
2. Só o dono (ou um admin) altera; "Criar cópia" é a forma de usar a apresentação de outra pessoa.
3. Admin gerencia usuários, convites, configurações e auditoria; demais são membros.
4. Não existe cadastro aberto: só entra quem foi convidado, com e-mail verificado e senha (mínimo 12 caracteres).
5. Excluir = lixeira (reversível); apagar de vez só admin.
6. O banco decide permissões (RLS); a API só diz quem é o usuário.

Detalhes e contratos: [`docs/API.md`](docs/API.md). Segurança: [`docs/SEGURANCA.md`](docs/SEGURANCA.md). Operação: [`docs/OPERACAO.md`](docs/OPERACAO.md).
