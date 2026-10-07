# syntax=docker/dockerfile:1
# Canteiro online — imagem da API (+ site estático) para hospedagem AUTOHOSPEDADA (alternativa à Vercel).
# >>> Build NÃO EXECUTADO por completo neste ambiente (sem acesso aos pacotes do Debian): revise e teste em staging antes de usar. <<<
#
# O build do site precisa de python3 e das pastas `studio/`, `am/` e `fonts2/` que ficam FORA de platform/.
# Por isso o contexto de build é a RAIZ do repositório:
#     docker build -f platform/Dockerfile -t canteiro:local .
# Imagem-base FIXADA por digest (node:22-bookworm-slim de 2026-10-07): o mesmo build sempre parte dos mesmos bytes. Para atualizar (correções de
# segurança do Debian/Node): `docker buildx imagetools inspect node:22-bookworm-slim` → copie o "Digest:" da lista → troque nos 3 FROM → teste.
# O contexto de build é enxuto graças ao .dockerignore da raiz (sem .git, node_modules, .tmp, .env).

# ---- 1) gera o site estático (dist/public) ---------------------------------------------------------------------------
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS web
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
COPY studio ./studio
COPY am ./am
COPY fonts2 ./fonts2
COPY platform ./platform
WORKDIR /repo/platform
RUN npm ci --omit=dev && node tools/build-web.js

# ---- 2) dependências de produção (com módulos nativos do sharp) -----------------------------------------------------------
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS deps
WORKDIR /app
COPY platform/package.json platform/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- 3) imagem final, enxuta e sem root -------------------------------------------------------------------------------------
FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS runtime
ENV NODE_ENV=production PORT=3000 PUBLIC_DIR=/app/dist/public
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY platform/package.json ./
COPY platform/src ./src
COPY platform/api ./api
COPY platform/db ./db
COPY platform/tools ./tools
COPY --from=web /repo/platform/dist ./dist
# pasta de arquivos para STORAGE_DRIVER=local (em produção use s3); volume montado pelo compose
RUN mkdir -p /data/objects && chown -R node:node /app /data
USER node
EXPOSE 3000
# /api/health não depende de nada externo: serve para o orquestrador reiniciar um contêiner travado
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
