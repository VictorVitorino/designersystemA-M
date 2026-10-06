# Evidências de teste — plataforma online do Canteiro

Tudo abaixo foi **executado nesta máquina** (Linux, 4 CPUs, 16 GB, Postgres 16 local, Chromium via Playwright, sem rede para fornecedores) em 2026-10-06.
O que depende de contas externas (Supabase, Vercel, GitHub Actions, domínio, e-mail) **não foi executado** e está marcado como tal em [`CONFIGURACAO.md`](CONFIGURACAO.md).

## 1. Preservação do editor original

| Prova | Resultado |
|---|---|
| Cópia do arquivo enviado (`original/Canteiro-AM (3).html`) | SHA-256 `dc93ceac…5099`, 1.893.245 bytes, igual ao build publicado da etapa S34b |
| Build autônomo a partir de `studio/` (`python3 assemble.py`) | **byte-idêntico** ao original (mesmo SHA-256), confirmado por `tools/build-cloud-editor.js --verify-standalone` |
| Build em nuvem (`platform/.tmp/cloud-build/cloud-editor.html`, 1.936 KB) | = `studio/` + extensão `ed-50-cloud` + 6 patches de uma linha, cada um exigido exatamente 1× (o build falha se `studio/` mudar) |
| Arquivo servido em `/editor/` e `/visualizar/` | byte-idêntico ao build em nuvem (mesmo SHA-256) |
| Portão de 35 baterias do editor sobre o build em nuvem (modo inerte) | ver §1.1 |
| Paridade pixel a pixel original × nuvem | ver [`evidencias/paridade.md`](evidencias/paridade.md) e §1.2 |

### 1.1 Portão de qualidade do editor (35 baterias)

PENDENTE_GATE

### 1.2 Prova de paridade (todos os efeitos, modelos, layouts, templates e quadros)

PENDENTE_PARIDADE

## 2. Banco de dados e isolamento (RLS)

`tests/db/isolation.test.js` contra Postgres real: **32 testes, 32 aprovados**. Cobrem: a API sem usuário não lê nenhuma tabela; o usuário não escala para `app_system`/`app_owner`/`postgres` mesmo por injeção de SQL; só 3 funções pré-login são executáveis; RLS ligada em todas as tabelas; acervo visível a todos; outro membro não altera/exclui (0 linhas); dono e admin alteram; ninguém cria em nome de outro; cópia isolada; lixeira; suspenso/convidado/inexistente não veem nada; versões só do dono; arquivos deduplicados sem vazamento; comentários e interações com matriz de permissões; e-mails invisíveis a membros; último admin protegido; convite só por admin; `resolve_identity` sem convite não entra; auditoria imutável com autor imposto pelo banco; limite de taxa; texto malicioso tratado como dado.

## 3. API, autenticação e segurança (suíte completa)

`node --test tests/unit tests/db tests/api tests/security` com a aplicação real (`createApp`) e GoTrue falso: **743 testes, 743 aprovados, 0 falhas**.

Inclui: fluxo convite → e-mail → senha → login; respostas equalizadas para e-mail inexistente × senha errada; `forgot` sempre 202; refresh/expiração/logout; tokens nunca no corpo; cookies com flags; JWT `alg none`/confusão/emissor errado recusados; CSRF (ausente, errado, Origin, Content-Type); limites de taxa; admin (membro 403 em tudo, último admin, suspensão derruba sessão); cabeçalhos; configuração de produção rígida; estático (traversal, MIME, CSP por página); 409 de conflito com `overwrite` e `pre_overwrite`; versões/restauração; integridade de referências de arquivo (sha desconhecido ou alheio → 422); deck malicioso → 422 e nada gravado (corpus de XSS); uploads (hash errado 400, SVG 415, 413, dedup com 2ª pessoa, imagem corrompida 422, GET por quem não pode ver 404); comentários e interações (matriz completa + CSV injection); 20 salvamentos concorrentes da mesma apresentação sem perda.

## 4. Cliente web e editor em nuvem

| Suíte | Resultado |
|---|---|
| `tests/web/web.test.js` (Playwright, páginas sob CSP estrita, com o cloud-core real) | **264 aprovados, 0 falhas** |
| `tests/cloud/cloud-core.test.js` (hash/canônico iguais ao servidor, externalizar/hidratar) | **15/15** |
| `tests/cloud/editor-cloud.test.js` (20 cenários: carregar, autosave, dedup, offline, conflito, histórico, visualizar, interações, exportações, CSP) | **101 aprovados, 0 falhas**; zero violações de CSP; editor 1.936 KB; 15 hashes de script |

## 5. Operação

`tests/ops/*.test.js`: **102 testes, 102 aprovados**. Ensaio de restauração executado de ponta a ponta: [`evidencias/restore-drill.md`](evidencias/restore-drill.md) (seed de 30 usuários, 200 apresentações, 448 arquivos; backup cifrado para pasta e para S3 falso; destruição; restauração em banco novo; 448/448 arquivos íntegros; RTO 2,5 s no acervo de teste).
`tools/dev.js` sobe a pilha inteira localmente: `/api/health` 200, `/api/ready` `{db,storage,auth,migrations: true}`, páginas com CSP por hash, link de convite do primeiro admin impresso.

## 6. Ponta a ponta com a pilha real

PENDENTE_E2E

## 7. Carga: 50 usuários simultâneos

PENDENTE_CARGA

## 8. Revisão ofensiva de segurança

PENDENTE_SEGURANCA

## 9. O que não pôde ser testado aqui

- Supabase real (Auth, Postgres gerenciado, Storage S3), Vercel (Functions, CDN, limites de 4,5 MB), GitHub Actions, domínio/HTTPS real, SMTP e entregabilidade de e-mail, SSO da A&M.
- Navegadores além do Chromium (Firefox, Safari).
- Latência de rede real entre Brasil e as regiões dos fornecedores.
