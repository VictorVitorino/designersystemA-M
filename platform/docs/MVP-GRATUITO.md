# Canteiro — MVP gratuito (piloto, NÃO produção)

**Objetivo:** publicar o editor existente com login, apresentações, imagens e recuperação em outro computador, sem contratar planos pagos e sem alterar `studio/`. Esta é uma **opção de hospedagem de testes** em paralelo à arquitetura Vercel Pro de `docs/PUBLICACAO.md`; não a substitui para uso comercial/produção.

**Arquitetura:** GitHub Free → **Render Free Web Service (Node 22, site + API)** → **Supabase Free (Postgres + Auth + Storage via S3)**.

Documentação dos limites: https://render.com/docs/free e https://supabase.com/docs/guides/storage/s3/authentication.
O Render Free pausa após 15 min sem visitas; a primeira requisição pode levar ~1 min; o armazenamento local é descartável; há limites de horas, banda e conexões externas. Supabase Free pode pausar projetos com pouca atividade. **Não usar para clientes pagantes, dados sensíveis ou disponibilidade contratual.**

## 1. Antes de começar

- Aprovar todos os checks do PR e a versão `main`: CI, Postgres 17, E2E e CodeQL. Caso contrário, **não publicar**.
- Não usar o projeto Supabase de outras iniciativas. Criar **projeto novo, separado**, de nome `canteiro-mvp`, plano **Free**, região **São Paulo** (`sa-east-1`). Confirmar que custa R$ 0 antes de criar.
- Nunca colocar senhas, strings de conexão, chaves S3 ou service keys no GitHub, em scripts, HTML ou neste arquivo. Usar apenas **Secrets** do GitHub e Environment do Render.
- Não configurar plano pago, DNS próprio, cartão, monitor pago ou testes de carga contínuos.
- O repositório deve ser privado antes de guardar dados reais ou ativos proprietários; revisar custos e impacto sobre limites do GitHub Free/Actions antes de alterar visibilidade.
- No Supabase, desabilitar **cadastro público**; a primeira conta é criada por convite. Verificar MFA, Auth, Rate Limits e acesso às tabelas. O projeto expõe somente o necessário; `app` não deve ser liberado pela Data API.

## 2. Preparar o Supabase Free

1. Criar o projeto dedicado e configurar **Auth** (URL do site e Redirect URLs após criação do Render), com convite por e-mail. O SMTP padrão do Supabase tem limites/restrições para envio; testar convite e recuperação com e-mail permitido antes de convidar outros.
2. Em Storage, criar um bucket **privado** para arquivos do Canteiro e **ativar o S3 protocol**. Gerar credenciais S3 exclusivas para uso **no servidor**. Essas credenciais têm acesso amplo aos buckets: mantê-las **somente em Secrets/Render**.
3. Para as migrações usar uma conexão **administrativa temporária** ao PostgreSQL (Session Pooler IPv4 se necessário). **Nunca** publicar essa conexão no Render.
4. Criar no GitHub o ambiente `mvp` com secrets `DATABASE_ADMIN_URL`, `APP_API_DB_PASSWORD` e `APP_OPS_DB_PASSWORD` (senhas distintas e fortes). Criar variável `SUPABASE_PROJECT_REF` com o identificador do **projeto novo**.
5. Executar manualmente `Actions → Preparar banco MVP Free` a partir de `main`, preenchendo exatamente `MVP` e o ref do projeto. O fluxo recusa rodar fora de `main`, em outro projeto ou sem confirmação; aplica migrações e confere os checksums.
6. Montar a string `DATABASE_URL` de **aplicação**, que conecta como **`app_api`** (não `postgres` / administrador, e nunca `app_ops`) ao banco recém-criado, por conexão TLS. É diferente de `DATABASE_ADMIN_URL`.

A configuração do projeto pode exigir ajustes adicionais no Supabase que ainda **não foram validados contra um serviço real**. Até todos os testes passarem, nenhum indicador deve mostrar `MVP publicado`.

## 3. Preparar o Render Free

1. Na página https://render.com/deploy?repo=https://github.com/VictorVitorino/designersystemA-M clique para implantar o Blueprint da `main` (ou selecione **New → Blueprint** no https://dashboard.render.com). O Blueprint cria **somente um Web Service `plan: free`**; não cria banco Render (o banco Render Free expira em 30 dias).
2. O Render fará o build com `npm ci --omit=dev`, Python 3 já disponível no runtime, e executará a API Node que serve o editor e as páginas. `autoDeployTrigger: off` evita publicação automática de mudanças não aprovadas.
3. **O endereço `APP_ORIGIN` é fornecido automaticamente pelo próprio Render**, via `fromService → RENDER_EXTERNAL_URL`. Antes de disponibilizar, preencha os demais campos `sync: false` no **Environment** do Render, sempre com os valores do projeto exclusivo Supabase:

| Variável | Valor / onde obter |
|---|---|
| `APP_ORIGIN` | **Automático no Blueprint**, por referência ao `RENDER_EXTERNAL_URL` do próprio serviço Render. Confira se coincide com o HTTPS atribuído. |
| `DATABASE_URL` | URL PostgreSQL do papel restrito `app_api`, pooler Supabase, **TLS** |
| `SUPABASE_URL` | Project URL do projeto `canteiro-mvp` |
| `SUPABASE_ANON_KEY` | Chave pública/anon do projeto (backend); nunca usar a secreta no HTML |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secreta **apenas no servidor** |
| `SUPABASE_JWKS_URL` | `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, conferir que o projeto usa JWT assimétrico |
| `S3_ENDPOINT` | Exemplo: `https://<ref>.storage.supabase.co/storage/v1/s3` |
| `S3_REGION` | Região **real** indicada no painel S3 do projeto |
| `S3_BUCKET` | Nome do bucket **privado** |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credenciais S3 exclusivas do projeto; **somente no servidor** |

O Blueprint já define `APP_ENV=staging`, `DATABASE_SSL=require`, `STORAGE_DRIVER=s3`, `S3_FORCE_PATH_STYLE=true`, `DB_POOL_MAX=2`, `STORAGE_QUOTA_USER_MB=100`, `NODE_VERSION=22.22.0` e gera `CSRF_SECRET`. Antes da API iniciar, o script `tools/mvp-preflight.js` bloqueia erros de configuração: só aceita HTTPS Render, banco como `app_api` via TLS, Auth/JWKS e S3 do mesmo projeto Supabase, cota limitada e nenhum segredo administrativo no Render. Ele não contata a rede nem imprime credenciais. `APP_ORIGIN` acompanha automaticamente a URL `*.onrender.com` atribuída pelo Render, sem copiar manualmente o endereço. Revise a URL no painel antes do piloto.

4. Configurar **Supabase Auth → URL Configuration**: Site URL = `APP_ORIGIN` e Redirect URLs para o site e a página `/auth/confirmar` (confirmar o fluxo exato do Auth ao testar).
5. **Primeiro administrador:** crie no ambiente GitHub `mvp` o Secret `DATABASE_OPS_URL` (conexão TLS como `app_ops`, sem usar `postgres`) e `SUPABASE_SERVICE_ROLE_KEY`, além da variável `SUPABASE_URL` com a URL HTTPS do mesmo projeto. Depois que as migrações forem concluídas, execute manualmente **Actions → Convidar administrador MVP Free**, preenchendo `ADMIN-MVP`, o ref do projeto, e-mail e nome. Confira o e-mail de convite e defina a senha; o SMTP padrão do Supabase Free pode restringir os destinatários. Nunca coloque `DATABASE_OPS_URL` no Render ou navegador. A chave `SUPABASE_SERVICE_ROLE_KEY` só pode existir como segredo no servidor Render e no ambiente protegido do GitHub, jamais no HTML/JavaScript público.
6. Clicar **Manual Deploy** depois de preenchidos os valores. Verificar `GET /api/health` (servidor vivo) e **`GET /api/ready` com status 200** (DB, login, arquivos e migrações). Não confundir esses dois endpoints: `health` pode estar verde com o banco fora do ar.

7. Após o deploy, executar **Actions → Verificar MVP Free online** na `main` com a URL do Render. O teste externo consulta apenas GET/HEAD, valida banco, login, armazenamento, CSP e arquivos essenciais, além de provar que visitantes sem login **não podem consultar apresentações**. **Ainda exige homologação manual em outro computador.**

## 4. Critérios para aprovar o MVP

- [ ] CI + E2E da **mesma** `main` aprovados
- [ ] Supabase Free exclusivo criado e migrações aplicadas
- [ ] Bucket privado com S3 funcional; **sem arquivos persistidos no disco temporário do Render**
- [ ] Render Free publicado em HTTPS, `/api/health` e `/api/ready` respondem 200
- [ ] Cadastro público desligado; convite de administrador e recuperação de senha comprovados
- [ ] Criar 3 slides, editar, fechar a aba e reabrir **em outro computador** sem perder texto nem imagens
- [ ] Acesso entre usuários e permissões testados; visitante sem conta não visualiza apresentações
- [ ] Importar arquivo do editor, exportar PPTX/PDF, histórico de versões e lixeira validados
- [ ] Sem chaves em arquivos públicos, logs, HTML nem no navegador
- [ ] Limites gratuitos e plano de saída entendidos; backup e restauração testados com dados fictícios

**Ainda não concluído:** implantação e validação contra Render/Supabase reais. O Blueprint facilita a instalação, mas não prova compatibilidade até o teste real.

## 5. Custo e limitações

**Previsão de mensalidade mínima: R$ 0**, respeitando limites gratuitos e sem contratar adicionais. Não garantimos custo zero se os limites de serviço forem excedidos ou se algum plano for alterado. No Render, sem método de pagamento, o serviço pode ser suspenso quando acaba a cota. A API ligada ao Supabase na rede externa pode ser suspensa se gerar tráfego incomum. Não hospedar o banco em Render Free: os bancos gratuitos de lá expiram em 30 dias.

Depois de aprovar o piloto, documentar resultados, preparar produção paga com disponibilidade e backups, e **não expor dados confidenciais de clientes em planos gratuitos sem revisão de privacidade e segurança**.

Referências: https://render.com/docs/blueprint-spec · https://render.com/docs/free · https://supabase.com/docs/guides/storage/s3/compatibility · https://supabase.com/docs/guides/storage/s3/authentication
