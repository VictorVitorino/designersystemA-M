# Interface web da plataforma (B1) — páginas e cliente

Páginas estáticas, sem framework e sem etapa de build própria: HTML + CSS + módulos ES. O build do site (`tools/build-web.js`) copia `platform/web/` para `dist/public`, junto do editor em nuvem e de `/js/cloud-core.js`.
Tudo roda sob a **CSP estrita** das páginas comuns (`default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`).

## Mapa

| Rota | Arquivo | Para quê |
|---|---|---|
| `/entrar` | `web/entrar/index.html` + `js/pages/entrar.js` | e-mail + senha; erros do contrato em pt-BR; `?next=` seguro |
| `/auth/confirmar?token_hash=…&type=invite\|recovery` | `web/auth/confirmar/` + `confirmar.js` | confirma o link do e-mail e define a senha |
| `/esqueci-senha` | `web/esqueci-senha/` + `esqueci.js` | pede o e-mail de redefinição (mesma resposta sempre) |
| `/acervo` | `web/acervo/` + `acervo.js` | tela principal: grade de cartões, busca, abas, gaveta de detalhes e comentários |
| `/admin` | `web/admin/` + `admin.js` | usuários, convites, auditoria, configurações, resumo (só admin) |
| `/importar` | `web/importar/` + `importar.js` | importa o acervo local (JSON do “Minhas obras” e HTMLs salvos) |
| `/404.html`, `/` | `web/404.html`, `web/index.html` | página de erro; `/` leva a `/acervo` (`<meta refresh>`) |
| `/editor/:id`, `/visualizar/:id` | — (B2) | só são **linkadas** daqui; `?historico=1` abre o histórico de versões |

Código compartilhado (`web/js/`): `api.js` (cliente de API), `session.js` (sessão + barra superior), `ui.js` (blocos de interface), `format.js` (pt-BR, `safeNext`, CSV seguro). Estilo: `web/css/tokens.css` (cores A&M, tipografia, espaços) e `web/css/app.css` (componentes). Ícones próprios em `web/assets/icons.svg` (sprite) e `favicon.svg`; logos vêm do build em `/assets/brand/`.

## Regras de código (a CSP exige — e o teste confere)

- Sem `<style>`, sem `style="…"`, sem `on…=`, sem `<script>` inline, sem `eval`/`new Function`, sem `javascript:`. Estados viram classes CSS; progresso usa `<progress>`; nenhum estilo é gravado por script.
- **Nenhum dado da API entra no DOM como marcação.** `ui.js` → `h(tag, props, ...filhos)` cria elementos; textos vão por `createTextNode`/`textContent`. `h()` recusa atributos `on*`, `style`, `srcdoc` e URLs `javascript:`.
- Nenhum token em JS/`localStorage`/`sessionStorage`. Sessão = cookies `HttpOnly` (`__Host-am_at`/`__Host-am_rt`; sem prefixo em dev); o JS só lê o cookie CSRF (legível de propósito). Única coisa guardada no `sessionStorage`: ids das apresentações já importadas (`am.import.done`), para retomar a importação.
- `?next=` só aceita caminho interno (`/…`, nunca `//`, `/\`, esquema, controles; o resultado normalizado também é conferido) e nunca devolve às telas de login — `format.js › safeNext`.

## Cliente de API (`api.js`)

- `fetch` com `credentials: 'same-origin'`, `cache: 'no-store'`; JSON por padrão; corpo binário com `binary: true`.
- **CSRF**: `X-CSRF-Token` = cookie `__Host-am_csrf` (ou `am_csrf`); se faltar, busca `GET /api/auth/session` antes. `403 csrf` → busca de novo e repete uma vez.
- **Sessão**: `401 session_expired` (e `unauthenticated`, que é o que chega quando o cookie de acesso já expirou no navegador) → **um** `POST /api/auth/refresh` compartilhado entre chamadas simultâneas (single-flight; uma chamada que já voltou depois do refresh só repete) e repete a requisição; se o refresh falha → `/entrar?next=<caminho>&motivo=sessao`. As páginas protegidas chamam `GET /api/auth/session` (o servidor renova sozinho quando só o acesso expirou) e, sem sessão, vão para `/entrar` (com `motivo=suspended|not_invited` quando o servidor explica).
- Timeout de 20 s (`ApiError` `timeout`), falha de rede (`network`), `429` com o tempo de espera do `Retry-After` (“…tente novamente em 8 minutos”), resposta não-JSON/5xx → mensagem amigável.
- `ApiError(status, code, message, details)`; `fieldErrors(err)` normaliza `details.fields` (`[{path,message}]` do servidor ou `{campo:[msgs]}`).

## Acessibilidade e responsividade

Rótulos reais em todos os campos (`label for`), erros ligados por `aria-describedby`/`aria-invalid` e foco no primeiro inválido, regiões `aria-live` (status da lista, importação, avisos), diálogos nativos `<dialog>` (foco preso, Esc fecha, foco volta a quem abriu), menus e abas no padrão WAI-ARIA (setas, Home/End), “Ir para o conteúdo”, anel de foco duplo visível em fundo claro e escuro, contraste AA conferido por varredura, `prefers-reduced-motion` respeitado, alvos de 44 px no celular, sem rolagem horizontal de 390 a 1920 px (tabelas viram cartões abaixo de 760 px).

## Como rodar e testar

```bash
export PATH=/opt/node22/bin:$PATH
node platform/tests/web/mock-api.js            # servidor de teste em http://127.0.0.1:4201 (páginas + API em memória)
node platform/tests/web/web.test.js            # bateria completa (Playwright/Chromium), ~70 s; ONLY=acervo,admin para rodar partes
WEB_CLOUD_CORE=stub node platform/tests/web/web.test.js   # força o stub do cloud-core (padrão: o módulo real, se existir)
```

`tests/web/mock-api.js` implementa o contrato em memória (cookies, CSRF + Origin, erros no formato do contrato, cursores, limites de taxa, RLS simulada) e serve `web/` com a CSP acima. Ganchos `/__test/*` (reset, expirar acesso, falha de refresh, log de requisições) só existem no mock. `tests/web/cloud-core-stub.js` replica a API do `cloud-core` para o caso de o módulo real não existir. Capturas em `platform/tests/screens/` (ignoradas pelo git).

## Suposições e pontos a combinar

- `GET /api/presentations` não tem parâmetro de ordenação: a ordem do servidor é `updatedAt desc`. Ao ordenar por outro critério o cliente carrega até 400 itens e ordena localmente (avisa se houver mais). Sugestão ao contrato: `sort=updated|created|title|slides`.
- `slideIndex` de comentário é **0-based** (a interface mostra “Slide N+1”), conforme `app.comments.slide_index`.
- Envio de imagens > 4 MB: o `cloud-core` chama `shrink()`; a página reduz no navegador (canvas) até ~3,75 MB. O fluxo direto para o bucket (`/api/assets/uploads`) só é usado se a URL assinada for da própria origem — com `connect-src 'self'` um PUT para o domínio do bucket seria bloqueado.
- O servidor estático de `src/static.js` responde 404 em texto simples (não usa `web/404.html`); na Vercel o `404.html` da raiz é usado automaticamente.
- A resposta de `Permissions-Policy` inclui `bluetooth=()`, que o Chromium não reconhece (aviso no console em toda página).
