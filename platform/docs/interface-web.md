# Interface web da plataforma (B1) — páginas e cliente

Páginas estáticas, sem framework e sem etapa de build própria: HTML + CSS + módulos ES. O build do site (`tools/build-web.js`) copia `platform/web/` para `dist/public`, junto do editor em nuvem e de `/js/cloud-core.js`.
Tudo roda sob a **CSP estrita** das páginas comuns (`default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`).

## Mapa

| Rota | Arquivo | Para quê |
|---|---|---|
| `/entrar` | `web/entrar/index.html` + `js/pages/entrar.js` | e-mail + senha ou a conta A&M (login corporativo/SSO); erros do contrato e `?motivo=` em pt-BR; `?next=` seguro |
| `/auth/confirmar?token_hash=…&type=invite\|recovery` | `web/auth/confirmar/` + `confirmar.js` | confirma o link do e-mail e define a senha |
| `/esqueci-senha` | `web/esqueci-senha/` + `esqueci.js` | pede o e-mail de redefinição (mesma resposta sempre) |
| `/acervo` | `web/acervo/` + `acervo.js` | tela principal: grade de cartões, busca, abas, gaveta de detalhes e comentários; “Nova a partir de projeto pronto”; no menu do cartão (dono/admin) “Respostas e participações…”, “Histórico de versões” e “Baixar como HTML / PDF / PowerPoint” |
| `/admin` | `web/admin/` + `admin.js` | usuários, convites, auditoria, configurações, resumo (só admin) |
| `/importar` | `web/importar/` + `importar.js` | importa o acervo local (JSON do “Minhas obras” e HTMLs salvos) |
| `/404.html`, `/` | `web/404.html`, `web/index.html` | página de erro; `/` leva a `/acervo` (`<meta refresh>`) |
| `/editor/:id`, `/visualizar/:id` | — (B2) | só são **linkadas** daqui: `?historico=1` abre o histórico de versões; `?exportar=html\|pdf\|pptx` (em nova aba) abre o editor já exportando; `?modelo=0..5` monta o projeto pronto da capa (`studio/cover.js`, mesma ordem) na apresentação recém-criada |

Código compartilhado (`web/js/`): `api.js` (cliente de API), `session.js` (sessão + barra superior), `ui.js` (blocos de interface), `format.js` (pt-BR, `safeNext`, CSV seguro, `pad2`, `slug`). Estilo: `web/css/tokens.css` (cores A&M, tipografia, espaços) e `web/css/app.css` (componentes). Ícones próprios em `web/assets/icons.svg` (sprite) e `favicon.svg`; logos vêm do build em `/assets/brand/`; miniaturas dos 6 projetos prontos em `web/assets/modelos/modelo-1..6.png` (1º slide de cada um, 640 × 360).

## Família visual = editor original

As páginas copiam os componentes do editor (`studio/editor.html`, `studio/cover.css`, `studio/ed-40-export.css`) com os mesmos valores — o teste 9b lê os estilos **computados** no editor autônomo publicado (`AM-Studio-Editor.html` da raiz, o build atual de `studio/`; `original/` é só a cópia do upload S34b) e na plataforma e compara.

- **Dois temas, como no original.** *Claro* (= área de trabalho do editor; usado no `/admin`): fundo `#E6EBF1`, barra `#top` navy. *Prancha* (= capa `#cover`; `body.theme-prancha` no acervo, importar, entrar, esqueci-senha, confirmar, 404 e `/`): navy `#001E32` com o degradê e a grade 96/24 px de `.cv-bg`. Os papéis de cor (`--text`, `--panel`, `--ctl-*`, `--fld-*`…) mudam por tema em `app.css`; superfícies brancas dentro da prancha (diálogos, menus, cartão de login) voltam aos papéis claros.
- **Componentes**: botão = `.mb`/`.tb` (`.btn--primary` = `.mb.pri`, laranja `#F78C16` com texto navy, hover `#E07A0A`); diálogo = `.mdl` (faixa 3 px laranja/navy, ícone 44 px, sobretítulo em JetBrains Mono, fundo `rgba(0,20,35,.52)` com desfoque); diálogo largo = `.xp-box`; menu = `.xmenu`; aviso = `#toast` (claro) / `.cv-note` (prancha); cartão = `.cv-hcard` (hover: sobe 3 px, borda laranja); selo = `.cv-htag`; busca = `.cv-search`; abas = `.cv-seg`; sobretítulos = `.cv-eyebrow`/`.mdl-ey`; “Projetos prontos” = vista `#cvTpl` da capa (diálogo `.dlg--prancha`, teclas 1–6, setas, Esc).
- **Fontes**: as mesmas famílias e pesos do editor, com o MESMO endereço do Google Fonts (Inter 400–700, JetBrains Mono 400–600, Roboto 300–700, Roboto Condensed 400/700); pilhas de reserva iguais às do editor.
- **Desvios deliberados (contraste AA)**: borda de campo `#7A8DA3` no tema claro (o `#DCE3EC` do editor não chega a 3:1 — WCAG 1.4.11); borda dos campos na prancha com alfa .5 (a capa usa .26); metadados dos cartões e dos projetos prontos em `#A3B8D6` (o `#7EA1C3` de `.cv-hmeta` cai para ~3,6:1 sobre o cartão no ponto claro do degradê). O risco das confirmações destrutivas aparece no ícone (caixa laranja), como no editor, que não tem botão vermelho; itens de menu destrutivos ficam em vermelho.

## Login corporativo (SSO) em `/entrar`

- Botão **Entrar com a conta A&M (SSO)** (`#btn-sso`, `type=button`): exige o e-mail no campo e leva a `GET /api/auth/sso?email=<e-mail digitado>&next=<destino atual>`; o servidor redireciona ao provedor e, na volta, ao destino (`next`).
- **Ligado ou não?** Se `GET /api/auth/session` trouxer `sso: { enabled: true }` (ou `sso: true`), o botão aparece em destaque (= `.mb`, largura total, com a divisória “ou” em mono); com `enabled: false`, não aparece. **Sem o campo** (o back-end de hoje), o botão fica discreto e, no clique, a página confere com `GET /api/auth/sso` **sem parâmetros e sem seguir o redirecionamento** (`redirect: 'manual'`): redirecionou = ligado (segue para o SSO); `501 not_configured` (ou 404) = “O login corporativo ainda não está disponível. Entre com e-mail e senha.” — nunca o JSON cru na tela. Sugestão ao contrato: mandar `sso: {enabled}` na sessão evita essa conferência.
- **Motivos** (`/entrar?motivo=<código>`, enviados pelo servidor nas navegações do SSO e nas sessões recusadas) viram mensagens fixas em pt-BR; o parâmetro nunca é ecoado e código desconhecido não mostra nada. `not_invited` (peça um convite), `suspended` (conta suspensa), `sessao` (sessão expirou; aviso discreto), `sso_email` (digite o e-mail corporativo completo), `sso_dominio` (o SSO vale só para os domínios da A&M), `sso_indisponivel` (fora do ar; tente em alguns minutos), `sso_expirou` (expirou ou começou em outro navegador), `sso_falhou` (cancelado ou recusado no provedor), `sso_limite` (muitas tentativas desta rede). Depois de um erro `sso_*` o botão fica em destaque (o SSO está ligado).

## Recursos do acervo para dono e administrador

- **Respostas e participações…** (menu do cartão e gaveta): diálogo largo com o que foi coletado no servidor, **por elemento** e na ordem dos slides (o título e o slide de cada formulário, votação ou quadro vêm do conteúdo da apresentação; elemento que já saiu do conteúdo aparece como “fora do conteúdo atual”). Formulário = tabela (Quando, Pessoa, uma coluna por pergunta; as 50 mais recentes); votação = soma dos pontos de todas as pessoas por opção; quadro = notas por coluna, com quem as tem (as notas iniciais do slide ficam marcadas). Por elemento: **Baixar CSV** (`GET /api/presentations/:id/interactions.csv?kind=…&elementId=…`, a rota do servidor: BOM, `;`, apóstrofo antes de `= + - @`) e **Apagar respostas deste elemento** (confirmação nomeando o elemento → `DELETE /api/presentations/:id/interactions?elementId=…&kind=…`, com CSRF; o aviso diz quantos registros saíram). Lista: `GET /api/presentations/:id/interactions` (itens `{id, kind, elementId, payload, author:{id,displayName}, createdAt, updatedAt}`).
- **Nova a partir de projeto pronto**: os 6 projetos da capa do editor (nomes e descrições de `studio/cover.js`, mesma ordem — o teste confere contra o arquivo), cada um com a miniatura do 1º slide. Escolher = `POST /api/presentations {source:'new', title:<nome do projeto>}` e abrir `/editor/<novo-id>?modelo=<0..5>`.
- **Baixar como HTML / PDF / PowerPoint**: itens-link do menu que abrem `/editor/<id>?exportar=html|pdf|pptx` em nova aba (`rel=noopener`); **Histórico de versões** aponta para `/editor/<id>?historico=1`. Quem não pode editar não vê esses itens.


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

Rótulos reais em todos os campos (`label for`), erros ligados por `aria-describedby`/`aria-invalid` e foco no primeiro inválido, regiões `aria-live` (status da lista, importação, avisos), diálogos nativos `<dialog>` (foco preso, Esc fecha, foco volta a quem abriu), menus e abas no padrão WAI-ARIA (setas, Home/End), “Ir para o conteúdo”, anel de foco duplo visível em fundo claro (anel laranja da capa na prancha), contraste AA conferido por varredura das cores computadas **e medido em pixels** sobre a prancha (texto transparente + captura: o fundo real, com degradê, cartões translúcidos e hover), `prefers-reduced-motion` respeitado, alvos de 44 px no celular, sem rolagem horizontal de 390 a 1920 px (tabelas viram cartões abaixo de 760 px).

## Como rodar e testar

```bash
export PATH=/opt/node22/bin:$PATH
node platform/tests/web/mock-api.js            # servidor de teste em http://127.0.0.1:4201 (páginas + API em memória)
node platform/tests/web/web.test.js            # bateria completa (Playwright/Chromium), alguns minutos; ONLY=acervo,admin para rodar partes; PORT=… troca a porta
node platform/tests/web/miniaturas-modelos.mjs # regenera web/assets/modelos/*.png a partir do editor original (fontes de fonts2/)
WEB_CLOUD_CORE=stub node platform/tests/web/web.test.js   # força o stub do cloud-core (padrão: o módulo real, se existir)
```

`tests/web/mock-api.js` implementa o contrato em memória (cookies, CSRF + Origin, erros no formato do contrato, cursores, limites de taxa, RLS simulada) e serve `web/` com a CSP acima. SSO: `GET /api/auth/sso` (desligado → `501 not_configured`; ligado → `302` ao “provedor” simulado `/__test/idp`, que confirma ou cancela) e `GET /api/auth/sso/callback` (sessão + `302` ao destino; erros → `302 /entrar?motivo=…`), domínio `am.test`; `/__test/sso?on=1&indicator=1` liga o SSO e o indicador em `/api/auth/session`. Interações: `GET/POST …/interactions`, `GET …/interactions.csv` (só dono/admin; mesmo formato do servidor) e `DELETE …/interactions?elementId=…[&kind=…]` (dono/admin apagam tudo do elemento; os demais, só as próprias → `200 {deleted:n}`); a apresentação “Plano estratégico 2027 (Bia)” traz formulário, votação e quadro com respostas de várias pessoas, incluindo textos hostis. Ganchos `/__test/*` (reset, expirar acesso, falha de refresh, log de requisições) só existem no mock. `tests/web/cloud-core-stub.js` replica a API do `cloud-core` para o caso de o módulo real não existir. Capturas em `platform/tests/screens/` (ignoradas pelo git).

## Suposições e pontos a combinar

- `GET /api/presentations` não tem parâmetro de ordenação: a ordem do servidor é `updatedAt desc`. Ao ordenar por outro critério o cliente carrega até 400 itens e ordena localmente (avisa se houver mais). Sugestão ao contrato: `sort=updated|created|title|slides`.
- `slideIndex` de comentário é **0-based** (a interface mostra “Slide N+1”), conforme `app.comments.slide_index`.
- Envio de imagens > 4 MB: o `cloud-core` chama `shrink()`; a página reduz no navegador (canvas) até ~3,75 MB. O fluxo direto para o bucket (`/api/assets/uploads`) só é usado se a URL assinada for da própria origem — com `connect-src 'self'` um PUT para o domínio do bucket seria bloqueado.
- O servidor estático de `src/static.js` responde 404 em texto simples (não usa `web/404.html`); na Vercel o `404.html` da raiz é usado automaticamente.
- A resposta de `Permissions-Policy` inclui `bluetooth=()`, que o Chromium não reconhece (aviso no console em toda página).
