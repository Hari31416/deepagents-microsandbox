from __future__ import annotations

import argparse
import os
import pathlib
import subprocess
from urllib.parse import urlsplit, urlunsplit

from langgraph_cli.cli import prepare_args_and_stdin
from langgraph_cli.config import validate_config_file
from langgraph_cli.docker import check_capabilities
from langgraph_cli.exec import Runner


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
BACKEND_DIR = REPO_ROOT / "backend"
CONFIG_PATH = BACKEND_DIR / "langgraph.json"
LANGGRAPH_ENV_PATH = BACKEND_DIR / ".langgraph.env"
LANGGRAPH_PORT = int(os.environ.get("LANGGRAPH_PORT", "8123"))
ROOT_ENV_PATH = REPO_ROOT / ".env"
LICENSE_ENV_KEYS = ("LANGSMITH_API_KEY", "LANGGRAPH_CLOUD_LICENSE_KEY")

PASSTHROUGH_ENV_KEYS = (
    "APP_ENV",
    "AGENT_MODEL",
    "LANGSMITH_API_KEY",
    "LANGGRAPH_CLOUD_LICENSE_KEY",
    "LANGCHAIN_API_KEY",
    "LANGCHAIN_TRACING_V2",
    "LANGCHAIN_PROJECT",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "GOOGLE_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Manage Docker-backed LangGraph runtime"
    )
    parser.add_argument("command", choices=("up", "down", "logs", "ps"))
    args = parser.parse_args()

    if args.command == "up":
        ensure_license_configured()
        write_langgraph_env()

    config = validate_config_file(CONFIG_PATH)
    postgres_uri = resolve_postgres_uri()

    with Runner() as runner:
        capabilities = check_capabilities(runner)

    compose_args, compose_stdin = prepare_args_and_stdin(
        capabilities=capabilities,
        config_path=CONFIG_PATH,
        config=config,
        docker_compose=None,
        port=LANGGRAPH_PORT,
        watch=False,
        postgres_uri=postgres_uri,
    )
    compose_stdin = sanitize_compose_stdin(compose_stdin)

    compose_cmd = (
        ["docker", "compose"]
        if capabilities.compose_type == "plugin"
        else ["docker-compose"]
    )

    if args.command == "up":
        run_compose(
            compose_cmd,
            compose_args,
            compose_stdin,
            ["up", "--remove-orphans", "--wait"],
        )
        return

    if args.command == "down":
        run_compose(
            compose_cmd, compose_args, compose_stdin, ["down", "--remove-orphans"]
        )
        return

    if args.command == "logs":
        run_compose(
            compose_cmd, compose_args, compose_stdin, ["logs", "-f", "langgraph-api"]
        )
        return

    run_compose(compose_cmd, compose_args, compose_stdin, ["ps"])


def write_langgraph_env() -> None:
    executor_port = load_env_value("EXECUTOR_PORT") or "3000"
    langgraph_env = {
        "EXECUTOR_BASE_URL": f"http://host.docker.internal:{executor_port}",
    }

    for key in PASSTHROUGH_ENV_KEYS:
        value = load_env_value(key)
        if value:
            langgraph_env[key] = value

    lines = [f"{key}={value}" for key, value in sorted(langgraph_env.items())]
    LANGGRAPH_ENV_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def ensure_license_configured() -> None:
    if any(load_env_value(key) for key in LICENSE_ENV_KEYS):
        return
    raise RuntimeError(
        "LangGraph startup requires LANGSMITH_API_KEY for local development or "
        "LANGGRAPH_CLOUD_LICENSE_KEY for licensed deployments."
    )


def resolve_postgres_uri() -> str:
    uri = load_env_value("LANGGRAPH_POSTGRES_URI") or load_env_value(
        "EXECUTOR_DATABASE_URL"
    )
    if not uri:
        raise RuntimeError(
            "EXECUTOR_DATABASE_URL must be set to start LangGraph with PostgreSQL persistence"
        )
    return rewrite_localhost_for_docker(uri)


def load_env_value(key: str) -> str | None:
    if key in os.environ and os.environ[key]:
        return os.environ[key]

    if not ROOT_ENV_PATH.exists():
        return None

    for raw_line in ROOT_ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        env_key, value = line.split("=", 1)
        if env_key.strip() != key:
            continue
        return value.strip().strip("'").strip('"')

    return None


def sanitize_compose_stdin(compose_stdin: str) -> str:
    # Docker Compose interpolates $VAR inside the generated inline Dockerfile.
    # LangGraph's generated dependency loop uses $dep and needs it preserved.
    return compose_stdin.replace("$dep", "$$dep")


def rewrite_localhost_for_docker(uri: str) -> str:
    parts = urlsplit(uri)
    hostname = parts.hostname
    if hostname not in {"localhost", "127.0.0.1"}:
        return uri

    netloc = parts.netloc
    if "@" in netloc:
        credentials, host_part = netloc.rsplit("@", 1)
        replacement = host_part.replace(hostname, "host.docker.internal", 1)
        netloc = f"{credentials}@{replacement}"
    else:
        netloc = netloc.replace(hostname, "host.docker.internal", 1)

    return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))


def run_compose(
    compose_cmd: list[str],
    compose_args: list[str],
    compose_stdin: str,
    command_args: list[str],
) -> None:
    subprocess.run(
        [*compose_cmd, *compose_args, *command_args],
        input=compose_stdin,
        text=True,
        cwd=REPO_ROOT,
        check=True,
    )


if __name__ == "__main__":
    main()
