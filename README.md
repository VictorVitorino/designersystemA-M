# Design System A&M · Canteiro

Código do **Canteiro**, o editor de apresentações da Alvarez & Marsal (interface em pt-BR): um único arquivo HTML que
edita, apresenta e exporta (HTML, PDF, PowerPoint editável) e importa .pptx/.pdf. Este repositório reúne **tudo que já foi
construído** (etapas S0 a S34b) e é onde seguem os próximos códigos.

## O que tem aqui

| Pasta / arquivo | O que é |
|---|---|
| `Canteiro-AM.html` · `AM-Studio-Editor.html` | Build publicado (mesmo arquivo, dois nomes). Abre direto no navegador. |
| `studio/` | Fontes do editor, runtime do player, extensões, testes e portão de QA. |
| `studio/docs/` | `ARCH.md` (arquitetura e invariantes), `KEYMAP.md`, `CATALOG.md`, `DTS-CONTROLS.md`, `TMG-FEATURES.md`. |
| `studio/inst/` | Slides institucionais A&M: specs JSON + artes + referências de fidelidade. |
| `studio/tools/inst-check.js` | Mede a fidelidade de um slide contra a imagem de referência. |
| `am/brand/` | Logos e marca A&M embutidos no build. |
| `fonts2/` | Fontes (Roboto, Roboto Condensed, Inter, Montserrat…) usadas nos testes, sem depender da rede. |
| `referencias/` | Guia de design DTS e apresentação institucional (referência visual). |
| `CLAUDE.md` | Regras de trabalho: processo, invariantes e convenções. |

## Como usar

```bash
cd studio
python3 assemble.py        # monta studio/AM-Studio-Editor.html (nome ignorado pelo git; o publicado fica na raiz)
node test-s34-institucional.js   # uma bateria
./qa-gate.sh               # portão completo (~9 min, 3 em paralelo) → "GATE PASS"
./qa-gate.sh quick test-sXX.js   # iteração rápida: test.js + test2.js + a bateria indicada
```

Requer Python 3, Node 22 com Playwright (Chromium) e, para as baterias de PowerPoint, `python-pptx` e Pillow.
O build não faz nenhuma chamada de rede.

## Publicar

Só o build que passou no portão: `cp studio/AM-Studio-Editor.html AM-Studio-Editor.html && cp studio/AM-Studio-Editor.html Canteiro-AM.html`.

## MVP na nuvem (piloto, gratuito)

O editor original continua disponível como arquivo HTML. Para **testar login e salvamento entre computadores**, a plataforma completa usa Render Free (site + API) e um projeto separado do Supabase Free (banco + autenticação + arquivos).

[![Implantar no Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/VictorVitorino/designersystemA-M)

O botão **não publica automaticamente**: você acessa o Render, confere o único serviço `plan: free` e preenche as credenciais do projeto **exclusivo** `canteiro-mvp` como variáveis seguras. O endereço HTTPS é preenchido automaticamente pelo Render. **Não cole senhas ou chaves secretas no GitHub/ChatGPT.**

**Antes de convidar usuários:** conclua as etapas e os testes em [Guia de implantação do MVP](platform/docs/MVP-GRATUITO.md), incluindo `/api/ready`, acesso anônimo bloqueado e reabertura em outro computador. A hospedagem gratuita tem suspensão por inatividade e não oferece SLA de produção.
