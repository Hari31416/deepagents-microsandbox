# Backend Authentication

The DeepAgent Sandbox uses a secure, token-based authentication system with support for both HTTP headers and secure cookies.

## Overview

Authentication is handled via **Signed JSON Tokens** (similar to JWT but with a custom lightweight implementation for maximum control). 

### Token Types

| Token | Purpose | Lifecycle |
| :--- | :--- | :--- |
| **Access Token** | Authorizes short-term requests. | 1 Hour |
| **Refresh Token** | Obtains new access tokens without re-login. | 30 Days |

## Implementation Details

### 1. Token Generation (`app/security.py`)
Tokens are signed using `HMAC-SHA256` with a server-side `SECRET_KEY`. The payload includes:
- `sub`: User ID
- `typ`: Token type (`access` or `refresh`)
- `iat`: Issued at timestamp
- `exp`: Expiration timestamp

### 2. Cookie-Based Auth
For frontend convenience and security against XSS, the access token can be delivered via a `HttpOnly`, `Secure` cookie named `deepagent_access_token`.

### 3. Middleware & Dependency Injection
The `get_current_user` dependency in `app/api/auth.py` orchestrates the extraction logic:

```python
def get_current_user(
    authorization: Annotated[str | None, Header(alias="Authorization")] = None,
    access_cookie: Annotated[str | None, Cookie(alias="deepagent_access_token")] = None,
) -> UserContext:
    # 1. Extract from Header or Cookie
    # 2. Verify Signature and Expiration
    # 3. Fetch User from Repository
    # 4. Return UserContext
```

## Auth Scopes

The system provides two primary helper dependencies to enforce higher-level access:
- `require_admin`: Ensures the user has `admin` or `super_admin` role.
- `require_super_admin`: Ensures the user specifically has the `super_admin` role.

## Security Considerations
- **Password Hashing**: Uses `scrypt` with a 16-byte salt and high iteration counts.
- **Refresh Token Isolation**: Refresh tokens are stored in the database and hashed (`SHA256`) before comparison to prevent database leak vulnerabilities.
