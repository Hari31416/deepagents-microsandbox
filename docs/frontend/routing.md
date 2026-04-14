# Rendering & Layout

The current application is a single-route dashboard where most interaction happens through state changes and sidebars.

## Main Layout

The main entry point is `App.tsx`, which wraps the `MainLayout`.

```tsx
function MainLayout() {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans text-foreground">
      <Sidebar />
      <main className="flex-1 flex flex-col relative min-w-0">
        <ChatArea />
      </main>
      <SidePanel />
    </div>
  )
}
```

## Responsive Strategy

- **Sidebar**: Collapsible on small screens or togglable via a button.
- **SidePanel**: Occupies the right side of the screen on desktop, and can be toggled to provide more space for the chat.
- **Flexbox**: Extensive use of `flex-col` and `flex-1` ensures that the chat area expands to fill the available height between the header and input.

## Conditional Rendering

Feature visibility (like the Artifact Viewer or the Trace List) is controlled via the `useStore` global state. This allows components to "react" to user actions across the layout (e.g., clicking a message to open its trace).
