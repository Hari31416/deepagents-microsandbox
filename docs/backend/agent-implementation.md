# Agent Implementation

The core intelligence of the sandbox is powered by an agentic graph built with **LangGraph** and the **DeepAgents** framework.

## Agent Architecture

Defined in `app/agent/graph.py`.

### 1. The Power Graph
We use a state machine architecture where nodes represent agent reasoning or tool execution.

### 2. Custom Backend (`MicrosandboxBackend`)
Located in `app/agent/backend.py`, this class implements the bridge between the high-level agent logic and our infrastructure:
- **`put_file` / `get_file`**: Interaction with MinIO for agent workspace synchronization.
- **`run_code`**: Secure execution via the `RuntimeService`.
- **`save_run_event`**: Persisting detailed traces of agent actions.

### 3. System Prompt
The persona and constraints of the agent are defined in `app/agent/prompts.py`. It is instructed to use Python for analysis and generate high-quality artifacts.

## Available Tools

The agent has access to a set of default tools:
- **Python Execution**: Running arbitrary Python code in the sandbox.
- **File Management**: Listing, reading, and creating files in the persistent workspace.
- **Artifact Management**: Explicitly marking generated charts or tables as artifacts to be displayed in the UI.

## Checkpointing & State

We use a `PostgresSaver` checkpointer. This allows the agent to:
- Remember previous conversation turns.
- Resume from errors or interruptions.
- Maintain a consistent state even after multi-step tool calls.

## Runtime Context

The `AgentContext` schema (Pydantic) defines the metadata available to the agent during execution, such as the `user_id` and `thread_id` for scoping.
