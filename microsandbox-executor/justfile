set shell := ["zsh", "-cu"]

web-build:
  cd web && bun install && bun run build

web-up:
  mkdir -p .run
  if [[ -f .run/web.pid ]] && kill -0 "$$(cat .run/web.pid)" 2>/dev/null; then \
    echo "Web UI is already running (pid $$(cat .run/web.pid))"; \
  else \
    (cd web && bun install > /dev/null && nohup bun run dev > ../.run/web.log 2>&1 & echo $$! > ../.run/web.pid); \
    echo "Started web UI (pid $$(cat .run/web.pid))"; \
    echo "Logs: .run/web.log"; \
  fi

web-down:
  if [[ -f .run/web.pid ]]; then \
    pid="$$(cat .run/web.pid)"; \
    if kill -0 "$$pid" 2>/dev/null; then \
      kill "$$pid"; \
      echo "Stopped web UI (pid $$pid)"; \
    else \
      echo "Web UI is not running"; \
    fi; \
    rm -f .run/web.pid; \
  else \
    echo "Web UI is not running"; \
  fi

web-logs:
  if [[ -f .run/web.log ]]; then \
    tail -f .run/web.log; \
  else \
    echo "No web log file found at .run/web.log"; \
  fi

sandbox-build:
  cd service && bun install && bun run build

sandbox-up:
  mkdir -p .run
  if [[ -f .run/sandbox.pid ]] && kill -0 "$(cat .run/sandbox.pid)" 2>/dev/null; then \
    echo "Sandbox service is already running (pid $(cat .run/sandbox.pid))"; \
  else \
    (cd service && nohup bun run dev > ../.run/sandbox.log 2>&1 & echo $! > ../.run/sandbox.pid); \
    echo "Started sandbox service (pid $(cat .run/sandbox.pid))"; \
    echo "Logs: .run/sandbox.log"; \
  fi

sandbox-down:
  if [[ -f .run/sandbox.pid ]]; then \
    pid="$(cat .run/sandbox.pid)"; \
    if kill -0 "$pid" 2>/dev/null; then \
      kill "$pid"; \
      echo "Stopped sandbox service (pid $pid)"; \
    else \
      echo "Sandbox service is not running"; \
    fi; \
    rm -f .run/sandbox.pid; \
  else \
    echo "Sandbox service is not running"; \
  fi

sandbox-logs:
  if [[ -f .run/sandbox.log ]]; then \
    tail -f .run/sandbox.log; \
  else \
    echo "No sandbox log file found at .run/sandbox.log"; \
  fi

build-data-science-image image="sandbox-data-science:py312-v1":
  docker build --platform linux/arm64 -t {{image}} images/data-science-runtime

test-data-science-image image="sandbox-data-science:py312-v1":
  docker run --rm --platform linux/arm64 {{image}} python3 -c "import numpy, pandas, matplotlib, seaborn, sklearn, plotly, scipy, openpyxl; print('data-science runtime ok')"

publish-data-science-image image:
  docker buildx build --platform linux/amd64,linux/arm64 -t {{image}} --push images/data-science-runtime
