#!/usr/bin/env bash
# Obtener certificados TLS de Let's Encrypt antes del primer despliegue.
# Requiere DNS apuntando a esta máquina y puertos 80/443 abiertos.
set -euo pipefail

BASE_DOMAIN="${SITEDOCK_BASE_DOMAIN:-sitedock.us.ci}"
EMAIL="${ACME_EMAIL:-admin@${BASE_DOMAIN}}"
DOMAINS=("api.${BASE_DOMAIN}" "www.${BASE_DOMAIN}" "app.${BASE_DOMAIN}" "admin.${BASE_DOMAIN}")

echo "=== Generando certificados TLS con Caddy ==="

if [ "${EMAIL}" = "admin@${BASE_DOMAIN}" ] && [ -z "${ACME_EMAIL:-}" ]; then
  echo "ADVERTENCIA: ACME_EMAIL no configurado. Edita .env antes de continuar."
fi

for domain in "${DOMAINS[@]}"; do
  echo "Caddy solicitará el certificado para ${domain} al iniciar."
done

echo "Listo. Ejecuta: docker compose up -d"
echo "Caddy obtendrá y renovará certificados automáticamente."
