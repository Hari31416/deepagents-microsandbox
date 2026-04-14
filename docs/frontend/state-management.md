# State Management

The application uses two distinct tools for state management: **Zustand** for transient UI state and **TanStack Query** for persistent server state.

## 1. UI State with Zustand

Implemented in `src/store/use-store.ts`.

### State Definition
- `threads`: Local cache of conversation threads.
- `activeThreadId`: The ID of the thread currently being viewed.
- `threadFiles`: Map of files available in each thread's workspace.
- `isSidebarOpen`: Toggle for the left navigation.
- `isWorkspaceOpen`: Toggle for the right-side feature panel.
- `selectedFile`: The file currently being viewed in the artifact viewer.

### Usage Pattern
```tsx
const { activeThreadId, setActiveThreadId } = useStore();
```

## 2. Server State with TanStack Query

We use React Query to handle data fetching, caching, and synchronization.

- **Fetching**: All GET requests (like fetching message history) are wrapped in `useQuery`.
- **Mutations**: POST requests (like creating a new thread) are handled via `useMutation`.
- **Invalidation**: After a successful mutation, we invalidate the related query keys to trigger an automatic refetch.

## Synchronizing Global State

In some cases, we synchronize Query results with the Zustand store (e.g., setting the `activeThreadId` the first time the thread list is loaded). This is typically done in the `useEffect` of the `MainLayout` or within a custom hook.
