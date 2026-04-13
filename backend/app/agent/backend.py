class MicrosandboxBackend:
    """Phase 4 placeholder for the custom DeepAgent sandbox backend."""

    def __init__(self, executor_base_url: str) -> None:
        self.executor_base_url = executor_base_url

    def execute(self, command: str, timeout: int | None = None):
        raise NotImplementedError("MicrosandboxBackend execution will be implemented in Phase 4.")
