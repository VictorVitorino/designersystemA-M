# SSO da A&M (SAML) — como ligar preservando contas e dados

**Situação hoje:** o login corporativo está **implementado na API e desligado por padrão** (`GET /api/auth/sso` e `/api/auth/sso/callback` respondem **501 `not_configured`** enquanto `SSO_ENABLED` não for `true`). O login por convite + e-mail verificado + senha continua valendo e convive com o SSO. Este roteiro liga o SSO **sem recriar usuários e sem perder apresentações**. Funcionamento por dentro: `docs/auth-e-sessoes.md` §SSO; contrato: `docs/API.md` §3.

## Por que as contas e os dados não se perdem

Todos os dados (apresentações, comentários, arquivos enviados…) apontam para **`app.users.id`**, um identificador interno estável — **nunca** para o id do Supabase Auth. A tabela `app.user_identities` liga *(provedor, sujeito)* → `app.users.id`. Hoje existe a linha `('supabase', <auth.users.id>)`. Ao entrar pelo SSO entra **mais uma** identidade para a **mesma pessoa** (`'sso:<id-do-provedor>'`), em vez de uma conta nova.

O vínculo é feito pela função do banco **`app.resolve_identity(provider, subject, email, email_verified, allow_email_link, touch)`**, chamada pelo retorno do SSO com `allow_email_link = true`:
1. se a identidade `(provider, subject)` já existe → devolve o usuário;
2. senão, e **só se** o e-mail estiver verificado, procura `app.users` pelo **e-mail** (convidado/ativo) e **acrescenta** a identidade nova a ele (o convidado tem o convite aceito);
3. se não há usuário com esse e-mail → **nada é devolvido** (quem não foi convidado não entra, nem por SSO); conta suspensa nunca ganha identidade nova.

> O Supabase **não** vincula automaticamente contas SAML às contas e-mail/senha existentes (cada uma é um `auth.users` separado — veja `docs/pesquisa/supabase.md`). É exatamente por isso que o vínculo mora na **nossa** tabela e é feito por e-mail verificado. Nunca use o e-mail como chave dos dados.

### O que a API confere (já implementado)

- **PKCE (S256)**: o código que o IdP devolve só vira sessão com o `code_verifier` guardado no cookie HttpOnly do **mesmo navegador** que começou o login (protege contra login CSRF e fixação de sessão; código de uso único).
- **Domínios** (`SSO_DOMAINS`): conferidos no início (e-mail/domínio pedido) **e** no retorno (o e-mail que o IdP afirmou). Um IdP mal configurado — ou de outra empresa — não vincula conta de domínio que não é dele.
- **E-mail verificado**: o GoTrue marca `email_verified = true` nas asserções SAML; a API exige essa declaração explícita no token de SSO (sem ela, não vincula) — e, além disso, o domínio do e-mail tem de estar em `SSO_DOMAINS`. Por isso só cadastre **o IdP corporativo** (nunca um IdP aberto, como Google pessoal).
- **Suspensão**: suspender uma pessoa no painel bane no Supabase **as duas** contas dela (a de senha e a do SSO); a barreira principal é o banco (vale em até 15 s).
- Erros voltam para a tela de entrada com `?motivo=` (`not_invited`, `suspended`, `sso_email`, `sso_dominio`, `sso_indisponivel`, `sso_expirou`, `sso_falhou`, `sso_limite`).

## Antes de começar (pendências externas)

- [ ] O TI da A&M fornece o **IdP** (Microsoft Entra ID / Okta…): URL de metadados SAML e um **grupo/aplicativo** com os usuários permitidos.
- [ ] Plano **Pro** (SAML a partir do Pro; 50 usuários SSO inclusos — confirme custo vigente em `docs/pesquisa/supabase.md`).
- [ ] Lista dos **domínios de e-mail** que entram pelo SSO (ex.: `alvarezandmarsal.com`) — vira `SSO_DOMAINS`, e os mesmos domínios vão no cadastro do provedor no Supabase.
- [ ] Um **segundo administrador** com acesso por senha (para voltar atrás se o SSO falhar).
- [ ] Combinar a janela com a TI e **testar primeiro em staging**.

## Passos (staging primeiro, depois produção)

1. **Backup antes**: rode `node tools/backup.js db` e confirme `verified: true` (`docs/BACKUP-E-RESTAURACAO.md`).
2. **No Supabase** (CLI, pois o painel não cadastra SAML): `supabase sso add --type saml --project-ref <ref> --metadata-url '<URL de metadados do IdP>' --domains <dominio-da-empresa>`. Anote o `id` do provedor devolvido (é o `<id>` de `sso:<id>` em `app.user_identities`). Envie ao TI da A&M os dados do *Service Provider* que o Supabase informa (`supabase sso show <id>`: Entity ID, ACS URL) para cadastrar no IdP, e mapeie o atributo **e-mail** (`email`) e **nome** (`name`).
3. **URL de retorno permitida** (sem isto o GoTrue manda a pessoa para a página inicial em vez do retorno da API): em Authentication → URL Configuration → *Redirect URLs*, acrescente **`https://<APP_ORIGIN>/api/auth/sso/callback`** (em `infra/supabase/config.toml`: incluir em `additional_redirect_urls`, ao lado de `/auth/confirmar`).
4. **Na Vercel** (variáveis da API do ambiente): `SSO_ENABLED=true` e `SSO_DOMAINS=<dominio-da-empresa>[,<outro>]`; redeploy. A API recusa iniciar se `SSO_ENABLED` vier sem `SSO_DOMAINS` válidos. Na tela de entrada, o botão "Entrar com a conta A&M" leva a `/api/auth/sso?email=<e-mail digitado>` (ou `?domain=<domínio>`), com `&next=` para voltar à página de onde a pessoa veio.
5. **Teste em staging** com 4 pessoas: (a) um admin existente; (b) um membro existente com apresentações; (c) uma pessoa **convidada** que ainda não definiu senha; (d) uma pessoa **não convidada**.
   - (a) e (b) entram pelo SSO e **veem as mesmas apresentações** de antes (`SELECT count(*) FROM app.presentations WHERE owner_id = …` não muda) e `app.user_identities` ganhou **uma** linha `sso:…` por pessoa;
   - (c) entra direto (o convite fica `accepted`);
   - (d) é recusada (`/entrar?motivo=not_invited`) e nenhuma linha nova aparece em `app.users`.
   - Conferir a auditoria: `auth.login` com `meta.via = 'sso'` e `meta.provider = 'sso:<id>'`.
6. **Convivência**: mantenha o login por senha ligado durante o período de transição (botão "Entrar com a conta A&M" ao lado do formulário). Só depois decida se desliga a senha (`auth-settings.md` item 1/4: não desligue o provedor Email: o admin de contingência precisa dele).
7. **Produção**: repita 1–5 com o IdP de produção; avise os usuários.

## Rollback (voltar a só senha)

1. `SSO_ENABLED=false` na Vercel (e redeploy): as rotas do SSO voltam a 501. O login por senha continua funcionando, porque `app.user_identities` mantém a linha `supabase`. Sessões SSO já abertas valem até expirar; para cortar alguém na hora, suspenda a pessoa.
2. Opcional: remover o provedor no Supabase (`supabase sso remove <id> --project-ref <ref>`).
3. As linhas `sso:…` em `app.user_identities` podem ficar (inofensivas) ou ser removidas; **nenhum dado de apresentação é tocado**.
4. Se alguém ficou preso: o admin de contingência convida de novo ou usa "Esqueci a senha".

## Armadilhas conhecidas

- **E-mail diferente no IdP** (ex.: apelido, caixa alta, `@empresa.com` × `@empresa.com.br`): o vínculo falha e a pessoa é recusada (`not_invited`). Corrija o e-mail em `app.users` pelo painel admin (PATCH) ou peça ao TI para alinhar o atributo. O banco guarda e-mail em minúsculas. Se a empresa usa dois domínios, ponha os dois em `SSO_DOMAINS` (e no provedor do Supabase).
- **Dois usuários com o mesmo e-mail** não existem (índice único); duas identidades para o mesmo usuário são normais (e uma pessoa pode ter duas `sso:…` se o IdP trocar o NameID — continua sendo a mesma conta).
- **Pessoa que sai da empresa**: suspenda em `Admin → Usuários` (revoga sessões e bane as duas contas no Supabase) e remova do grupo no IdP.
- **Não convidado que passou pelo IdP** fica com uma conta SAML sem acesso no `auth.users` do Supabase (a plataforma recusa e revoga a sessão); pode ser apagada pelo painel.
- Não cadastre IdP aberto (ex.: Google pessoal): a confiança no e-mail vem do IdP corporativo **e** de `SSO_DOMAINS`.
