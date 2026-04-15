# Environment Variables

The system uses environment variables for configuration across all components.

## Backend Variables (`backend/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `APP_NAME` | `deepagent-sandbox-backend` | Name used for logs and headers |
| `DATABASE_URL` | `postgresql+psycopg://...` | Main DB connection string |
| `POSTGRES_URI` | `None` | Alternative URI for LangGraph |
| `EXECUTOR_BASE_URL` | `http://localhost:3000` | URL of the sandbox service |
| `AGENT_MODEL` | `openai:gpt-4o-mini` | LLM model identifier |
| `MINIO_ENDPOINT` | `localhost:9000` | MinIO server address |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO credentials |
| `MINIO_SECRET_KEY` | `minioadminpassword` | MinIO credentials |
| `AUTH_SECRET_KEY` | `deepagent-dev-secret` | HMAC signing key for access tokens; must be overridden outside development |
| `AUTH_COOKIE_SECURE` | `false` | Whether auth cookies require HTTPS; must be `true` outside development |
| `AUTH_LOGIN_MAX_ATTEMPTS` | `5` | Failed login attempts allowed per email/IP window |
| `AUTH_LOGIN_WINDOW_SECONDS` | `300` | Sliding window for failed login attempt counting |
| `AUTH_LOGIN_LOCKOUT_SECONDS` | `900` | Temporary lockout duration after repeated failed logins |
| `SUPER_ADMIN_PASSWORD` | `ChangeMe123!` | Seed password for the initial super-admin; must be overridden outside development |

## Frontend Variables (`frontend/.env`)

| Variable | Default | Description |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000/api` | Absolute backend API URL used by the browser |
| `VITE_DEFAULT_USER_ID` | `dev-user` | Static ID for dev testing |

## Infrastructure Variables (Root `.env`)

Used by `docker-compose.yml`.

| Variable | Default | Description |
| --- | --- | --- |
| `POSTGRES_USER` | `deepagent` | DB root user |
| `POSTGRES_PASSWORD` | `deepagent_password` | DB root password |
| `REDIS_PASSWORD` | `redis_password` | Redis access password |
| `MINIO_ROOT_USER` | `minioadmin` | MinIO admin user |
| `MINIO_ROOT_PASSWORD` | `minioadminpassword` | MinIO admin password |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3001,http://127.0.0.1:3001` | Frontend origins allowed to call the backend with credentials |
