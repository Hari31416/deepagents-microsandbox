# Frontend Architecture

The frontend is a modern React application built with TypeScript and Vite, designed for speed and responsiveness.

## Technology Stack

- **Framework**: React 18+
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + shadcn/ui
- **State Management**: Zustand
- **Data Fetching**: TanStack Query (React Query)
- **API Client**: Axios

## Component Structure

The frontend follows a feature-based organization:

- `src/components/ui/`: Reusable primitive components from shadcn/ui.
- `src/components/chat/`: Message-related components (ChatHistory, MessageItem, etc.).
- `src/components/side-panel/`: Components for file management and execution trace.
- `src/hooks/`: Custom React hooks for business logic and side effects.
- `src/store/`: Zustand store for global application state.

## Global State Management

We use **Zustand** for lightweight, performant global state.

- **`useStore`**: Manages active threads, selected files, sidebar visibility, and UI toggles.

## Server State & Caching

We use **TanStack Query** for managing asynchronous server state.

- **Threads & Messages**: Fetched and cached using Query keys like `['threads']` and `['messages', threadId]`.
- **Automatic Refetching**: Handles optimistic updates and cache invalidation after mutations.

## SSE Streaming Logic

A custom hook `useChatMessages` handles the Server-Sent Events (SSE) stream from the backend.

- **SSE Parser**: Converts the raw stream into structured events.
- **Message Updates**: Optimistically updates the message list and handles partial content during streaming.
- **Trace Injection**: Injects tool execution steps into the UI as they occur.

## Design Philosophy

- **Responsive Design**: Mobile-friendly layout using Tailwind's responsive utilities.
- **Dark Mode Support**: Built-in dark mode using CSS variables and Tailwind classes.
- **Accessibility**: ARIA labels and keyboard navigation support via shadcn/ui components.
