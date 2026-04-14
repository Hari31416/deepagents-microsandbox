set shell := ["zsh", "-cu"]
set dotenv-load := true

default:
  @just --list

up:
  docker compose up -d

down:
  docker compose down

nuke:
  docker compose down -v --remove-orphans

up-all: up backend-start executor-start frontend-start langgraph-start

down-all: frontend-stop langgraph-stop executor-stop backend-stop down

nuke-all: frontend-stop langgraph-stop executor-stop backend-stop nuke

install-uv:
  if command -v uv >/dev/null 2>&1; then \
    echo "uv is already installed: $$(command -v uv)"; \
  else \
    curl -LsSf https://astral.sh/uv/install.sh | sh; \
  fi

install-pnpm:
  if command -v pnpm >/dev/null 2>&1; then \
    echo "pnpm is already installed: $$(command -v pnpm)"; \
  else \
    corepack enable && corepack prepare pnpm@latest --activate; \
  fi

backend-setup:
  cd backend && uv sync --group dev

backend-start:
  mkdir -p .run
  if [[ -f .run/backend.pid ]] && kill -0 "$$(cat .run/backend.pid)" 2>/dev/null; then \
    echo "Backend API is already running (pid $$(cat .run/backend.pid))"; \
  else \
    (cd backend && if [[ ! -x .venv/bin/uvicorn ]]; then uv sync --group dev > /dev/null; fi && nohup ./.venv/bin/uvicorn app.api.main:app --host 0.0.0.0 --port ${BACKEND_PORT:-8000} > ../.run/backend.log 2>&1 & echo $$! > ../.run/backend.pid); \
    echo "Started backend API (pid $$(cat .run/backend.pid))"; \
    echo "Logs: .run/backend.log"; \
  fi

backend-stop:
  @echo "Stopping backend on port ${BACKEND_PORT:-8000}..."
  @lsof -ti :${BACKEND_PORT:-8000} | xargs kill -9 2>/dev/null || true
  @rm -f .run/backend.pid
  @echo "Backend stopped."

logs-backend:
  if [[ -f .run/backend.log ]]; then \
    tail -f .run/backend.log; \
  else \
    echo "No backend log file found at .run/backend.log"; \
  fi

executor-setup:
  cd microsandbox-executor/service && bun install

executor-start:
  mkdir -p .run
  if [[ -f .run/executor.pid ]] && kill -0 "$$(cat .run/executor.pid)" 2>/dev/null; then \
    echo "Sandbox executor is already running (pid $$(cat .run/executor.pid))"; \
  else \
    (cd microsandbox-executor/service && nohup bun run dev > ../../.run/executor.log 2>&1 & echo $$! > ../../.run/executor.pid); \
    echo "Started sandbox executor (pid $$(cat .run/executor.pid))"; \
    echo "Logs: .run/executor.log"; \
  fi

executor-stop:
  @echo "Stopping executor on port ${EXECUTOR_PORT:-3000}..."
  @lsof -ti :${EXECUTOR_PORT:-3000} | xargs kill -9 2>/dev/null || true
  @rm -f .run/executor.pid
  @echo "Executor stopped."

langgraph-start:
  cd backend && .venv/bin/python scripts/langgraph_docker.py up
  echo "Started LangGraph on port ${LANGGRAPH_PORT:-8123}"
  echo "Logs: just logs-langgraph"

langgraph-stop:
  @echo "Stopping LangGraph on port ${LANGGRAPH_PORT:-8123}..."
  @cd backend && .venv/bin/python scripts/langgraph_docker.py down || true
  @echo "LangGraph stopped."

logs-langgraph:
  cd backend && .venv/bin/python scripts/langgraph_docker.py logs

logs-executor:
  if [[ -f .run/executor.log ]]; then \
    tail -f .run/executor.log; \
  else \
    echo "No executor log file found at .run/executor.log"; \
  fi

frontend-setup:
  if [[ -d frontend ]]; then \
    cd frontend && pnpm install; \
  else \
    echo "frontend/ does not exist yet; skipping frontend setup"; \
  fi

frontend-start:
  mkdir -p .run
  if [[ ! -d frontend ]]; then \
    echo "frontend/ does not exist yet; skipping frontend start"; \
  elif [[ -f .run/frontend.pid ]] && kill -0 "$$(cat .run/frontend.pid)" 2>/dev/null; then \
    echo "Frontend is already running (pid $$(cat .run/frontend.pid))"; \
  else \
    (cd frontend && nohup pnpm dev -- --host 0.0.0.0 --port ${FRONTEND_PORT:-3001} > ../.run/frontend.log 2>&1 & echo $$! > ../.run/frontend.pid); \
    echo "Started frontend (pid $$(cat .run/frontend.pid))"; \
    echo "Logs: .run/frontend.log"; \
  fi

frontend-stop:
  @echo "Stopping frontend on port ${FRONTEND_PORT:-3001}..."
  @lsof -ti :${FRONTEND_PORT:-3001} | xargs kill -9 2>/dev/null || true
  @rm -f .run/frontend.pid
  @echo "Frontend stopped."

frontend-preview:
  if [[ -d frontend ]]; then \
    cd frontend && pnpm build && pnpm preview -- --host 0.0.0.0 --port ${FRONTEND_PORT:-3001}; \
  else \
    echo "frontend/ does not exist yet; skipping frontend preview"; \
  fi

logs-frontend:
  if [[ -f .run/frontend.log ]]; then \
    tail -f .run/frontend.log; \
  else \
    echo "No frontend log file found at .run/frontend.log"; \
  fi

setup: backend-setup executor-setup frontend-setup

start: up backend-start executor-start langgraph-start frontend-start

stop: frontend-stop langgraph-stop executor-stop backend-stop down

restart: stop start

logs:
  files=(); \
  [[ -f .run/backend.log ]] && files+=(.run/backend.log); \
  [[ -f .run/executor.log ]] && files+=(.run/executor.log); \
  [[ -f .run/frontend.log ]] && files+=(.run/frontend.log); \
  if (( $${#files[@]} == 0 )); then \
    echo "No backend/executor/frontend log files found under .run/"; \
    echo "Use 'just logs-langgraph' for LangGraph container logs."; \
  else \
    tail -f "$${files[@]}"; \
  fi

ps:
  echo "== Docker Compose =="; \
  docker compose ps; \
  echo; \
  echo "== Processes =="; \
  for name in backend executor frontend; do \
    pidfile=".run/$$name.pid"; \
    if [[ -f "$$pidfile" ]]; then \
      pid="$$(cat "$$pidfile")"; \
      if kill -0 "$$pid" 2>/dev/null; then \
        echo "$$name: running (pid $$pid)"; \
      else \
        echo "$$name: stale pid file ($$pidfile)"; \
      fi; \
    else \
      echo "$$name: stopped"; \
    fi; \
  done; \
  if curl -fsS "http://localhost:${LANGGRAPH_PORT:-8123}/ok" >/dev/null 2>&1; then \
    echo "langgraph: running"; \
  else \
    echo "langgraph: stopped"; \
  fi

health:
  echo "== Backend =="; \
  curl -fsS "http://localhost:${BACKEND_PORT:-8000}/api/health" || true; \
  echo; \
  echo "== Sandbox Executor =="; \
  curl -fsS "http://localhost:${EXECUTOR_PORT:-3000}/v1/health" || true; \
  echo; \
  echo "== LangGraph =="; \
  curl -fsS "http://localhost:${LANGGRAPH_PORT:-8123}/ok" || true; \
  echo; \
  echo "== Docker Compose =="; \
  docker compose ps
