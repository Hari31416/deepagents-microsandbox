# UI Components

We use a component-based approach with a strong emphasis on reusability and clean separation of concerns.

## Feature Components

Located in `src/components/`.

### `ChatArea`
The central hub for messaging. It manages the message list container and the scroll behavior.

### `ChatInput`
A rich text input area that handles message submission, file attachments, and multiline text.

### `SidePanel`
A collapsible right panel that serves multiple roles:
- **Workspace**: Displays files uploaded to the current thread.
- **Artifact Viewer**: Provides a high-fidelity view of code, charts, or detailed data tables.
- **Trace List**: Shows the step-by-step execution path of the agent for the current run.

### `Sidebar`
The left navigation area for managing threads, including creation, renaming, and switching.

## Shared UI Primitives

Located in `src/components/ui/`. These are provided by **shadcn/ui** and built on top of **Radix UI**.

- **Buttons & Inputs**: Standard form controls with consistent styling.
- **Tabs**: Used in the SidePanel to switch between Workspace and Trace.
- **ScrollArea**: Custom scrollbars that match the application's aesthetic.
- **Tooltips & Dialogs**: Accessible overlays for additional information and actions.

## Composition Pattern

We use a composition pattern where components accept `children` or other components as props. This reduces prop-drilling and makes the layout more flexible.

```tsx
<SidePanel>
    <Tabs defaultValue="workspace">
        <TabsList>...</TabsList>
        <TabsContent value="workspace">...</TabsContent>
    </Tabs>
</SidePanel>
```
