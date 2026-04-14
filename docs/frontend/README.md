# Frontend Documentation

The frontend is a single-page application (SPA) built with **React**, **TypeScript**, and **Vite**. It is designed to provide a low-latency, responsive interface for interacting with AI agents.

## Core Features

- **Streaming Chat**: Real-time display of agent reasoning and tool execution.
- **Workflow Management**: Create and switch between multiple chat threads.
- **Artifact Viewer**: Integrated side panel for viewing generated content like charts, code, and tables.
- **Workspace Integration**: Upload and manage files that the agent can use in its analysis.

## Key Technologies

- **Vite**: Ultra-fast build tool and dev server.
- **shadcn/ui**: Modern, accessible component library based on Radix UI.
- **Tailwind CSS**: Utility-first CSS framework.
- **Zustand**: Lightweight global state management.
- **TanStack Query**: Asynchronous state management for server data.
- **Lucide React**: Clean and consistent icon set.

## Environment Configuration

The frontend requires the following environment variables (defined in `.env`):
- `VITE_API_BASE_URL`: The base URL for the backend API (e.g., `http://localhost:8000/api`).
- `VITE_DEFAULT_USER_ID`: A default user ID used for local development.
