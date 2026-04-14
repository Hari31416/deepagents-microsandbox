# Project Structure

The frontend code resides in the `frontend/src` directory and follows a modern, organized structure.

## Directory Layout

```text
src/
├── assets/          # Static assets like images and global CSS
├── components/      # React components
│   ├── chat/        # Feature-specific: Chat and messaging
│   ├── side-panel/  # Feature-specific: Workspace and tracing
│   └── ui/          # Generic: shadcn/ui primitives
├── hooks/           # Custom React hooks (business logic)
├── lib/             # Utilities and API clients
├── store/           # Zustand store definitions
├── types/           # TypeScript type definitions
├── App.tsx          # Main layout component
└── main.tsx         # Application entry point
```

## Component Philosophy

- **Presentational vs Container**: We aim to separate UI logic (hooks) from rendering (components) where possible.
- **Composition**: Larger features are composed of smaller, reusable primitives from `src/components/ui`.
- **Atomic Design**: shadcn/ui provides the atoms and molecules, which we assemble into organisms (like `Sidebar` or `ChatArea`).

## Styling Convention

- **Tailwind CSS**: All styling is done using utility classes.
- **`cn` Utility**: We use the `cn` utility (from `lib/utils.ts`) for conditional class merging.
- **CSS Variables**: Theme colors and spacing are defined as CSS variables in `index.css`, allowing for easy theming.
