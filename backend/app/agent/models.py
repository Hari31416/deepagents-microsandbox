from pydantic import BaseModel, Field


class AgentContext(BaseModel):
    user_id: str
    thread_id: str
    selected_file_ids: list[str] = Field(default_factory=list)
    workspace_files: list[str] = Field(default_factory=list)


class AgentArtifact(BaseModel):
    object_key: str
    content_type: str
