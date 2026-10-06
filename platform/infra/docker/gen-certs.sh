#!/usr/bin/env bash
# Gera o certificado autoassinado do Postgres do docker-compose (uma vez). NÃO EXECUTADO neste ambiente.
# Uso:  bash infra/docker/gen-certs.sh   (precisa de openssl e sudo para dar a posse ao usuário "postgres" do contêiner, uid 999)
set -euo pipefail
dir="$(cd "$(dirname "$0")" && pwd)/pgcerts"
mkdir -p "$dir"
openssl req -new -x509 -days 825 -nodes -subj "/CN=postgres" -newkey rsa:3072 -keyout "$dir/server.key" -out "$dir/server.crt"
chmod 600 "$dir/server.key"; chmod 644 "$dir/server.crt"
sudo chown 999:999 "$dir/server.key" "$dir/server.crt"
echo "Certificado gerado em $dir (validade de 825 dias: anote a data para renovar)."
