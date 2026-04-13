"""Repository-shaped stubs for the future Postgres-backed implementation."""


class ThreadRepository:
    def create_thread(self, *args, **kwargs):
        raise NotImplementedError("Phase 3 will replace the in-memory thread service with Postgres.")

    def get_thread(self, *args, **kwargs):
        raise NotImplementedError("Phase 3 will replace the in-memory thread service with Postgres.")
