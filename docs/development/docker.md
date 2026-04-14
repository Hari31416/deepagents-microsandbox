# Docker & Orchestration

We use Docker Compose to manage the local development environment and ensure consistent infrastructure across different machines.

## Services

Detailed in `docker-compose.yml`.

### 1. `postgres`
The primary relational database.
- **Persistent Volume**: `postgres_data`
- **Healthcheck**: Uses `pg_isready` to ensure the DB is accepting connections before dependent services start.

### 2. `minio` & `minio-create-bucket`
The object storage system.
- **Initialization**: The `minio-create-bucket` ephemeral container runs a script to ensure the required bucket exists and has correct permissions.
- **Persistent Volume**: `minio_data`

### 3. `redis`
Used for caching and potential background task queues.
- **Persistent Volume**: `redis_data`
- **Security**: Password protected via the `REDIS_PASSWORD` environment variable.

## Network Architecture

All containers are connected to a default bridge network. Services within the network can communicate using their service names (e.g., the backend connects to `postgres:5432`).

## Cleanup

To stop and remove all containers and volumes:

```bash
just nuke
```

To stop and remove containers for both infra and the application services:

```bash
just nuke-all
```
