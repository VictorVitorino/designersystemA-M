# SSO da A&M (SAML/OIDC) — como ligar preservando contas e dados

**Situação hoje:** `GET /api/auth/sso/start` e `/callback` respondem **501 `not_configured`**. O login é por convite + e-mail verificado + senha. Este roteiro liga o SSO **sem recriar usuários e sem perder apresentações**.

## Por que as contas e os dados não se perdem

Todos os dados (apresentações, comentários, arquivos enviados…) apontam para **`app.users.id`**, um identificador interno estável — **nunca** para o id do Supabase Auth. A tabela `app.user_identities` liga *(provedor, sujeito)* → `app.users.id`. Hoje existe a linha `('supabase', <auth.users.id>)`. Ao ligar o SSO entra **mais uma** identidade para a **mesma pessoa** (`'sso:<id-do-provedor>'`), em vez de uma conta nova.

O vínculo é feito pela função do banco **`app.resolve_identity(provider, subject, email, email_verified, allow_email_link, touch)`**:
1. se a identidade `(provider, subject)` já existe → devolve o usuário;
2. senão, e **só se** `allow_email_link` e `email_verified` forem verdadeiros, procura `app.users` pelo **e-mail verificado** (convidado/ativo) e **acrescenta** a identidade nova a ele;
3. se não há usuário com esse e-mail → **nada é devolvido** (quem não foi convidado não entra, nem por SSO).

> O Supabase **não** vincula automaticamente contas SAML às contas e-mail/senha existentes (cada uma é um `auth.users` separado — veja `docs/pesquisa/supabase.md`). É exatamente por isso que o vínculo mora na **nossa** tabela e é feito por e-mail verificado. Nunca use o e-mail como chave dos dados.

## Antes de começar (pendências externas)

- [ ] O TI da A&M fornece o **IdP** (Microsoft Entra ID / Okta…): URL de metadados SAML (ou OIDC) e um **grupo/aplicativo** com os usuários permitidos.
- [ ] Plano **Pro** (SAML a partir do Pro; 50 usuários SSO inclusos — confirme custo vigente em `docs/pesquisa/supabase.md`).
- [ ] Decisão: o IdP **garante e-mail verificado**? Só nesse caso `email_verified=true` pode ser enviado ao `resolve_identity` para esse provedor. Registre a decisão.
- [ ] Um **segundo administrador** com acesso por senha (para voltar atrás se o SSO falhar).
- [ ] Combinar a janela com a TI e **testar primeiro em staging**.

## Passos (staging primeiro, depois produção)

1. **Backup antes**: rode `node tools/backup.js db` e confirme `verified: true` (`docs/BACKUP-E-RESTAURACAO.md`).
2. **No Supabase** (CLI, pois o painel não cadastra SAML): `supabase sso add --type saml --project-ref <ref> --metadata-url '<URL de metadados do IdP>' --domains <dominio-da-empresa>`. Anote o `id` do provedor devolvido. Envie ao TI da A&M os dados do *Service Provider* que o Supabase informa (`supabase sso show <id>`: Entity ID, ACS URL) para cadastrar no IdP, e mapeie o atributo **e-mail** (`email`) e **nome** (`name`).
3. **Na API** (trabalho de desenvolvimento, já previsto no contrato): implementar `/api/auth/sso/start` (chama `POST {SUPABASE_URL}/auth/v1/sso` com o `domain` ou `provider_id` e devolve a URL do IdP) e `/api/auth/sso/callback` (troca o código por sessão e chama `resolve_identity('sso:<id>', sub, email, <verificado>, true, true)`). Variáveis novas: `SSO_ENABLED=1`, `SSO_PROVIDER_ID`, `SSO_ALLOWED_DOMAINS`. Sem esse código, o passo 2 sozinho **não** liga o SSO para os usuários.
4. **Teste em staging** com 3 pessoas: (a) um admin existente; (b) um membro existente com apresentações; (c) uma pessoa **não convidada**.
   - (a) e (b) entram pelo SSO e **veem as mesmas apresentações** de antes (`SELECT count(*) FROM app.presentations WHERE owner_id = …` não muda) e `app.user_identities` ganhou **uma** linha `sso:…` por pessoa;
   - (c) é recusada (`not_invited`).
   - Conferir a auditoria: `auth.login` com o provedor SSO.
5. **Convivência**: mantenha o login por senha ligado durante o período de transição (botão "Entrar com a conta A&M" ao lado do formulário). Só depois decida se desliga a senha (`auth-settings.md` item 1/4: não desligue o provedor Email: o admin de contingência precisa dele).
6. **Produção**: repita 1–4 com o IdP de produção; avise os usuários.

## Rollback (voltar a só senha)

1. Desligar `SSO_ENABLED` na Vercel (e redeploy). O login por senha continua funcionando, porque `app.user_identities` mantém a linha `supabase`.
2. Opcional: remover o provedor no Supabase (`supabase sso remove <id> --project-ref <ref>`).
3. As linhas `sso:…` em `app.user_identities` podem ficar (inofensivas) ou ser removidas; **nenhum dado de apresentação é tocado**.
4. Se alguém ficou preso: o admin de contingência convida de novo ou usa "Esqueci a senha".

## Armadilhas conhecidas

- **E-mail diferente no IdP** (ex.: apelido, caixa alta, `@empresa.com` × `@empresa.com.br`): o vínculo falha e a pessoa é recusada. Corrija o e-mail em `app.users` pelo painel admin (PATCH) ou peça ao TI para alinhar o atributo. O banco guarda e-mail em minúsculas.
- **Dois usuários com o mesmo e-mail** não existem (índice único); duas identidades para o mesmo usuário são normais.
- **Pessoa que sai da empresa**: suspenda em `Admin → Usuários` (revoga sessões) e remova do grupo no IdP.
- Não confie em `email_verified` vindo de IdP aberto (ex.: Google pessoal); aceite só o IdP corporativo.
