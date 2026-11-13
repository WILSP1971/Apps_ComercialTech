#!/usr/bin/env bash
# Sube este proyecto al repositorio https://github.com/WILSP1971/Apps_ComercialTech
# Requisitos: git instalado y acceso al repositorio (HTTPS con token personal o SSH).
set -euo pipefail
REPO_HTTPS="https://github.com/WILSP1971/Apps_ComercialTech.git"

[ -d .git ] || git init -b main
git add -A
git commit -m "feat: esqueleto inicial CRM Inteligente (monolito modular, DDD, offline-first, reglas R1-R14)" || true
git remote get-url origin >/dev/null 2>&1 || git remote add origin "$REPO_HTTPS"

# Si el repositorio ya tiene contenido (por ejemplo un README), se integra primero:
git fetch origin main 2>/dev/null && git pull origin main --rebase --allow-unrelated-histories || true
git push -u origin main
