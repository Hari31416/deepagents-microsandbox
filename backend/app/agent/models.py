from pydantic import BaseModel


class AgentContext(BaseModel):
    user_id: str
    thread_id: str
    selected_file_ids: list[str] = []


class AgentArtifact(BaseModel):
    object_key: str
    content_type: str
