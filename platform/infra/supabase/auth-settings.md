# Supabase — checklist de configuração do painel (Auth, banco, Storage, API)

Faça **os dois projetos** (staging e produção), marcando cada item. Os nomes das telas mudam de vez em quando: se não achar, procure pelo termo em itálico.
> **Não validado contra o painel real** (este documento foi escrito sem acesso a um projeto Supabase). No primeiro projeto de staging, confira cada item e corrija o texto aqui.
> Plano: itens marcados **(Pro)** exigem o plano Pro (o contratado). Fonte dos limites e preços: `docs/pesquisa/supabase.md`.

## A. Authentication → Sign In / Providers

- [ ] **1. Desligar o cadastro aberto.** *Allow new users to sign up* = **DESLIGADO**. Só convite (o convite usa a chave de serviço, que ignora essa chave).
  *Como testar:* `curl -s -X POST "$SUPABASE_URL/auth/v1/signup" -H "apikey: $SUPABASE_ANON_KEY" -H 'content-type: application/json' -d '{"email":"qualquer@teste.com","password":"SenhaLonga123!"}'` → precisa responder erro "Signups not allowed".
- [ ] **2. Exigir confirmação de e-mail.** Provedor *Email* ligado, *Confirm email* = **LIGADO**. Em *Email* deixe também *Secure email change* = LIGADO (troca de e-mail confirma nos dois endereços).
- [ ] **3. Desligar tudo que não usamos:** *Anonymous sign-ins*, *Phone*, e todos os provedores OAuth (Google, GitHub…). Eles só se ligam quando houver necessidade e decisão de segurança.
- [ ] **4. Senha.** *Minimum password length* = **12**. *Password requirements* = letras maiúsculas e minúsculas e dígitos. Ligar **proteção contra senha vazada** (*Prevent use of leaked passwords*, base HaveIBeenPwned) **(Pro)**. A API também recusa as senhas comuns e a que contém o e-mail (`docs/API.md` §3).
- [ ] **5. Expiração do link/código (OTP).** *Email OTP Expiration* = **86400** segundos (24 h, o máximo permitido). O padrão é 1 hora: curto demais para um convite que alguém abre no dia seguinte. Se expirar, o admin usa **Reenviar** (até 5 vezes).
  > O convite no banco vale 7 dias (`app.invites.expires_at`), mas o **link** do e-mail vale o que estiver aqui. Quem abrir depois pede novo convite.

## B. Authentication → Sessions (e JWT)

- [ ] **6. Rotação do refresh token.** *Detect and revoke potentially compromised refresh tokens* = **LIGADO**; *Refresh token reuse interval* = **10** segundos (evita falso alarme quando a aba renova duas vezes ao mesmo tempo; é o que a API também faz com renovações simultâneas).
- [ ] **7. Duração da sessão.** *JWT expiry* = **3600** (1 h; é o que o cookie de acesso espera). **(Pro)** *Time-box user sessions* = **30 dias** e *Inactivity timeout* = **7 dias** (combina com o cookie de renovação de 30 dias). Consequência: quem ficar 7 dias sem abrir o Canteiro precisa entrar de novo.
- [ ] **8. Chaves de assinatura do JWT assimétricas.** Project Settings → *JWT Keys* (*JWT Signing Keys*): migrar do segredo legado HS256 para **ECC (P-256, ES256)**. Depois preencha `SUPABASE_JWKS_URL=https://<ref>.supabase.co/auth/v1/.well-known/jwks.json` na Vercel e **não** cadastre `SUPABASE_JWT_SECRET`. Revogue o segredo legado depois de confirmar que os logins funcionam.
  > *Chaves da API (anon/service_role × publishable/secret):* o Supabase também tem as chaves novas `sb_publishable_…` / `sb_secret_…`. A API as envia no cabeçalho `apikey`. **Pendência para validar em staging:** se os endpoints `/auth/v1/admin/*` e `/auth/v1/invite` aceitam a chave nova só no `apikey`; se responderem 401, use as chaves legadas (JWT) até validar. Qualquer que seja, ela só existe no servidor.
- [ ] **9. Limites de taxa do GoTrue.** Authentication → *Rate Limits*. **Importante:** como TODOS os logins passam pela API, o Supabase enxerga poucos IPs (os da Vercel) e aplica o limite "por IP" a todos juntos. Suba *Rate limit for sign-ups and sign-ins* e *Rate limit for token verifications* para algo como **300 por 5 min**. O freio por usuário/IP de verdade é o da própria API (`app.hit_rate`: 8 tentativas/10 min por e-mail+IP).

## C. Authentication → Emails

- [ ] **10. SMTP próprio (obrigatório antes do primeiro convite).** *SMTP Settings* → *Enable custom SMTP*: host, porta (465/587), usuário e senha do provedor de e-mail (Resend, Amazon SES, Postmark, SendGrid…). *Sender email* `nao-responda@<seu-dominio>`, *Sender name* `Canteiro A&M`. O SMTP padrão do Supabase só entrega para a equipe do projeto e a 2 e-mails/hora: **não serve**. Depois ajuste *Rate Limits → Emails per hour* (padrão 30) para o volume real.
  Configure no DNS do domínio remetente: **SPF**, **DKIM** (o provedor fornece) e **DMARC** (`v=DMARC1; p=quarantine; rua=mailto:<caixa>`), senão o convite cai em spam (`docs/CONFIGURACAO.md` §DNS e e-mail).
- [ ] **11. Modelos de e-mail** (*Email Templates*): cole os de `templates/`:
  | Modelo do painel | Arquivo | Assunto sugerido |
  |---|---|---|
  | *Invite user* | `templates/invite.html` | `Você foi convidado para o Canteiro A&M` |
  | *Reset password* | `templates/recovery.html` | `Redefinir sua senha do Canteiro A&M` |
  | *Confirm sign up* | `templates/confirm.html` | `Confirme seu e-mail no Canteiro A&M` |
  O link usa `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite` (ou `recovery`): leva a **nossa** página, que troca o código pela sessão (cookie HttpOnly). Não use `{{ .ConfirmationURL }}`. O modelo *Confirm sign up* é só reserva (como o cadastro está desligado, quase nunca é enviado) e usa o mesmo fluxo do convite (`type=invite`), os únicos tipos que a API aceita (`docs/API.md` §3).

## D. Authentication → URL Configuration

- [ ] **12. Site URL** = o valor **exato** de `APP_ORIGIN` do ambiente (ex.: `https://canteiro.<seu-dominio>`; staging: `https://staging.canteiro.<seu-dominio>`). É o `{{ .SiteURL }}` dos e-mails. Se estiver errado, os convites apontam para o lugar errado.
- [ ] **13. Redirect URLs** (lista de permissão): somente `https://canteiro.<seu-dominio>/auth/confirmar` (e, em staging, o equivalente). **Sem curingas** (`**`), sem `localhost` em produção. Em staging pode-se acrescentar `http://localhost:3000/auth/confirmar` para testes locais.

## E. Database

- [ ] **14. SSL obrigatório.** Project Settings → Database → *SSL Configuration* → *Enforce SSL on incoming connections* = **LIGADO** (reinicia o banco por alguns segundos; faça fora do horário de uso). As conexões do Canteiro já pedem `sslmode=require`; para verificação completa use `sslmode=verify-full` com o certificado do projeto (baixe no mesmo painel).
- [ ] **15. Restrição de rede (*Network Restrictions*).** Lista de IPs que podem abrir conexão com o Postgres/pooler. **Cuidado:** as funções da Vercel e os runners do GitHub **não têm IP fixo**; ligar a restrição sem IP fixo **derruba a API e o CI**. Recomendação do MVP: **não ligar** e compensar com senha longa + TLS obrigatório + papéis mínimos (`app_api`/`app_ops`). Para ligar no futuro é preciso IP fixo de saída (Vercel Static IPs, se o plano permitir — **dependência externa a confirmar**) e um runner com IP conhecido para o CI.
- [ ] **16. Backups.** Database → *Backups*: o plano Pro mantém backups diários por 7 dias. **PITR** (recuperação ponto-a-ponto, ~US$ 100/mês) é opcional: só vale se o RPO de 24 h for pouco. Com PITR ativo o Supabase deixa de fazer o backup diário (o PITR o substitui). **Nada disso inclui os arquivos do Storage**, e nada disso substitui o nosso backup externo cifrado (`docs/BACKUP-E-RESTAURACAO.md`).
- [ ] **17. Senha do `postgres`** forte e única, no cofre de senhas. As senhas de `app_api` e `app_ops` **não** são definidas aqui: `tools/migrate.js` as define a partir de `APP_API_DB_PASSWORD`/`APP_OPS_DB_PASSWORD`.

## F. Project Settings → API (Data API)

- [ ] **18. Desabilitar a Data API do schema `app`.** O Canteiro não usa PostgREST. O mais seguro: *Data API* → desligar por completo (*Enable Data API* = OFF). Se preferir manter, em *Exposed schemas* deixe **apenas** `public` (nunca `app`) e *Extra search path* sem `app`. `tools/verify-deploy.js` falha se achar `app` em `pgrst.db_schemas` e tenta uma leitura com a chave anônima (precisa responder erro).

## G. Storage

- [ ] **19. Bucket privado.** Storage → *New bucket* → nome `canteiro-arquivos` (staging: `canteiro-arquivos-staging`), **Public bucket = DESLIGADO**. Defina *Restrict file size* (ex.: 100 MB) e tipos permitidos (png, jpeg, webp, gif, pdf, pptx, csv). **Não crie políticas** em `storage.objects` para `anon`/`authenticated`: sem política = ninguém acessa pela API pública; só a nossa chave S3 (que fica no servidor).
- [ ] **20. Chaves S3.** Storage → *S3 Connection* → *New access key*. Endpoint `https://<ref>.supabase.co/storage/v1/s3`, região `sa-east-1`, `S3_FORCE_PATH_STYLE=true`. **A chave S3 do Supabase tem acesso total e ignora RLS**: guarde só na Vercel (API) e no ambiente do GitHub (verificação/backup). Gere **uma chave por ambiente**; para rotacionar, crie a nova, troque na Vercel e no GitHub, depois apague a antiga.
  *Como testar o isolamento:* abra `https://<ref>.supabase.co/storage/v1/object/public/canteiro-arquivos/a/00/00/<qualquer>` → deve dar 400/404, nunca 200. O `verify-deploy` faz esse teste com um arquivo real.

## H. Conta e organização

- [ ] **21. MFA** em todas as contas com acesso ao painel; ao menos 2 pessoas com papel de dono da organização (continuidade); e-mail de cobrança de uma caixa compartilhada.
- [ ] **22. Alertas de uso e *Spend cap*.** Pro tem *Spend cap* ligado por padrão: o que passar da cota é **bloqueado** (não cobrado). Decida conscientemente: para evitar queda por excesso de arquivos/egress, desligue o spend cap **e** configure alertas de cobrança; para evitar surpresa de fatura, mantenha ligado e monitore (`node tools/maintenance.js stats`).
- [ ] **23. Registro das decisões:** anote em `docs/AMBIENTES.md` a data, quem configurou e o `ref` de cada projeto.

## Verificação final (cada ambiente)

```bash
DATABASE_ADMIN_URL='postgres://postgres:<SENHA>@db.<ref>.supabase.co:5432/postgres?sslmode=require' \
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> \
STORAGE_DRIVER=s3 S3_ENDPOINT=… S3_BUCKET=… S3_ACCESS_KEY_ID=… S3_SECRET_ACCESS_KEY=… \
node tools/verify-deploy.js
```
Tudo **OK** (avisos como "API S3 deste provedor não permite consultar políticas" são esperados no Supabase). Se algo **FALHOU**, corrija antes de convidar usuários.
