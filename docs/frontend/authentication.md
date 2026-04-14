# Frontend Authentication & User Experience

The DeepAgent Sandbox features a high-fidelity, premium authentication experience designed to provide a welcoming and secure entry point for users.

## The Login Screen (`LoginScreen`)

The entry point of the application is the `LoginScreen` component (`src/components/login-screen.tsx`). It has been redesigned to follow a modern "Mega-Card" layout.

### Visual Architecture

- **Layout**: A centered, large glassmorphism container with an internal vertical/horizontal split.
- **Background**: A sophisticated light-gray gradient with subtle radial pulses and a grainy noise overlay for a premium "pro" feel.
- **Glassmorphism**: Uses `backdrop-blur-2xl`, `bg-white/5` (for dark elements), and `bg-white` (for form elements) to create depth.
- **Typography**: Uses the **Inter** font family with tight tracking and black (900) weights for headings.

### Premium Features

| Feature | Implementation |
| :--- | :--- |
| **Mesh Gradients** | Multi-layered radial gradients for visual depth. |
| **Glow Icons** | Lucide icons with filtered background glows and gradient borders. |
| **Micro-Animations** | Hover-lift effects on buttons and smooth focus transitions on inputs. |
| **Friendly Copy** | "Where data meets intelligence" – focusing on outcome-driven messaging. |

## Session Management

Authentication state is managed via a combination of **Zustand** (global state) and **Secure HttpOnly Cookies**.

### 1. The Auth Store (`src/store/use-store.ts`)
The `useStore` hook manages the `currentUser` object. When a user logs in:
1. `authApi.login()` is called.
2. The backend sets an `access_token` cookie.
3. The store's `currentUser` is populated.

### 2. Guarded Routing
In `App.tsx`, the presence of `currentUser` determines whether the user sees the `LoginScreen` or the main `Dashboard`.

```tsx
return currentUser ? <Dashboard /> : <LoginScreen />
```

## Security Best Practices
- **XSS Protection**: Tokens are stored in `HttpOnly` cookies, preventing JavaScript access to sensitive session data.
- **CSRF Consideration**: While using custom headers for API calls, the system is designed to handle credentialed requests securely.
- **Error Handling**: Friendly, non-revealing error messages are displayed for failed login attempts (e.g., "Authentication failed. Check your credentials.")
