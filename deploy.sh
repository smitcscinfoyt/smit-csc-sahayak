#!/bin/bash
  set -Eeuo pipefail

  # =====================================
  # CONFIG
  # =====================================
  APP_DIR="$HOME/smit-csc-sahayak"
  BRANCH="main"
  REPO_URL="https://github.com/smitcscinfoyt/smit-csc-sahayak.git"

  log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

  # =====================================
  # ENSURE DOCKER AUTO-STARTS ON REBOOT
  # =====================================
  sudo systemctl enable docker 2>/dev/null || true
  sudo systemctl start  docker 2>/dev/null || true

  # =====================================
  # CHECK APP DIRECTORY
  # =====================================
  if [ ! -d "$APP_DIR/.git" ]; then
    log "Cloning repository..."
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  cd "$APP_DIR"

  # =====================================
  # PULL LATEST CODE
  # =====================================
  log "Pulling latest from $BRANCH..."
  git fetch origin
  git reset --hard "origin/$BRANCH"
  git clean -fd

  # =====================================
  # WRITE ENVIRONMENT FILE
  # =====================================
  log "Writing .env..."
  # Variables are injected by GitHub Actions from repository secrets
  # (see .github/workflows/deploy.yml)
  cat > .env << 'ENVEOF'
  # Written by deploy.sh — do not edit manually
  ENVEOF

  # Append secrets passed as env vars from GitHub Actions
  [ -n "${PORT:-}"           ] && echo "PORT=${PORT}"                     >> .env || echo "PORT=5001"                       >> .env
  [ -n "${GEMINI_API_KEY:-}" ] && echo "GEMINI_API_KEY=${GEMINI_API_KEY}" >> .env
  [ -n "${DATABASE_URL:-}"   ] && echo "DATABASE_URL=${DATABASE_URL}"     >> .env

  # =====================================
  # BUILD & RESTART CONTAINERS
  # =====================================
  log "Stopping old containers..."
  docker compose down --remove-orphans 2>/dev/null || true
  sleep 2

  log "Building and starting containers..."
  docker compose up --build -d

  sleep 5

  # =====================================
  # STATUS
  # =====================================
  log "Running containers:"
  docker ps --filter "name=smit-csc-sahayak"

  log "Health check..."
  for i in 1 2 3 4 5; do
    if curl -sf http://localhost:5001/api/health > /dev/null; then
      log "✅ API healthy on port 5001"
      break
    fi
    log "Waiting... ($i/5)"
    sleep 3
  done

  log "Deployment complete!"
  