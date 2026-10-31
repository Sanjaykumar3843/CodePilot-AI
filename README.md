# CodePilot AI — Developer Workspace & AI Coding Assistant

CodePilot AI is a full-stack developer workspace and AI coding assistant application. It pairs a React frontend dashboard with an Express API backend featuring Groq AI integration, PostgreSQL/fallback persistent authentication, reviewable unified code diffs, secure project file operations, and a real-time WebSocket editor bridge.

---

## 1. System Architecture

```
codepilot-ai/
├── backend/
│   ├── server.js                    # HTTP + WebSocket server lifecycle and DB migration runner
│   ├── src/
│   │   ├── app.js                   # Express application setup, security headers, CORS, routers
│   │   ├── config.js                # Environment variable parsing and validation
│   │   ├── db/
│   │   │   ├── index.js             # PostgreSQL connection pool & migration runner
│   │   │   ├── schema.sql           # Database schema (users, sessions, tasks)
│   │   │   ├── userRepository.js    # User accounts (dual-mode: Postgres / atomic JSON fallback)
│   │   │   └── sessionRepository.js # Session tokens (dual-mode: Postgres / atomic JSON fallback)
│   │   ├── middleware/
│   │   │   ├── auth.js              # Token extraction (Bearer header, cookie), requireAuth guard
│   │   │   └── rateLimiter.js       # Express rate limiters (auth, AI, general)
│   │   ├── routes/
│   │   │   ├── auth.js              # /api/auth (register, login, logout, me)
│   │   │   ├── tasks.js             # /api/tasks (list, create)
│   │   │   ├── files.js             # /api/files (tree, read, diff, apply)
│   │   │   └── ai.js                # /api/ai (status, generate)
│   │   └── services/
│   │       ├── aiService.js         # Groq SDK integration, structured JSON prompts, retries
│   │       ├── editorSocket.js      # WebSocket server bridge for editor navigation and events
│   │       ├── fileSystemService.js  # Path traversal protection, unified diffs, atomic writes
│   │       └── taskStore.js         # Atomic JSON file task persistence
│   └── test/
│       └── api.test.js              # Integration & security test suite (node:test)
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Main dashboard, navigation, AI orchestration, state
│   │   ├── App.css                  # Dark-theme design system, responsive styles, a11y
│   │   └── components/
│   │       ├── AuthModal.jsx        # Login & registration dialog with validation
│   │       ├── DiffViewer.jsx       # Side-by-side / unified code diff reviewer & apply actions
│   │       └── ProjectTreeModal.jsx # Project file hierarchy explorer & context selector
│   └── package.json
└── README.md
```

---

## 2. Requirements

- **Node.js**: version 18.0.0 or higher
- **npm**: version 8.0.0 or higher
- **PostgreSQL** *(optional)*: version 14 or higher. If `DATABASE_URL` is not set, CodePilot AI automatically runs in local dual-mode using atomic JSON storage in `backend/data/`.
- **Groq API Key** *(optional for AI completions)*: obtain from [Groq Console](https://console.groq.com).

---

## 3. Quickstart & Local Setup

### Step 1: Configure Backend Environment
```powershell
cd backend
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```
Edit `backend/.env` to configure your settings (e.g. `GROQ_API_KEY`, `DATABASE_URL`, or `PORT`).

### Step 2: Start the Backend
```powershell
npm run dev
```
Backend will start at `http://localhost:3001` with WebSocket bridge at `ws://localhost:3001/ws/editor`.

### Step 3: Configure Frontend Environment
In a second terminal:
```powershell
cd frontend
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

### Step 4: Start the Frontend
```powershell
npm run dev
```
The Vite development server will start at `http://localhost:5173` (or `5174`).

---

## 4. Configuration Variables

### Backend (`backend/.env`)
| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Express HTTP & WebSocket server port |
| `FRONTEND_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Allowed CORS browser origins |
| `PROJECT_ROOT` | Workspace root (`../..`) | Directory boundary for file inspection and safe writes |
| `DATABASE_URL` | *(empty)* | PostgreSQL connection URI. Empty triggers atomic JSON fallback |
| `GROQ_API_KEY` | *(empty)* | Groq API key for AI generation. Empty triggers clear status warning |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Supported Groq model identifier |
| `SESSION_SECRET` | `codepilot-dev-secret...` | Session cryptographic secret key |
| `NODE_ENV` | `development` | Environment mode (`development`, `production`, `test`) |

### Frontend (`frontend/.env`)
| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:3001` | Backend HTTP API base URL |
| `VITE_WS_URL` | `ws://localhost:3001` | WebSocket bridge URL for editor integration |

---

## 5. API Contracts

All endpoints return JSON responses with standard HTTP status codes.

### Health & Diagnostics
- **`GET /api/health`**
  - Response: `{ "success": true, "status": "healthy", "database": { "connected": bool, "driver": "..." }, "ai": { "configured": bool, "model": "..." } }`

### Authentication (`/api/auth`)
- **`POST /api/auth/register`**: `{ email, password, name }`
  - Validates email format, enforces >= 8 character passwords, returns `{ success: true, user, token }` and sets `codepilot_session` cookie.
- **`POST /api/auth/login`**: `{ email, password }`
  - Verifies bcrypt password hash, generates regenerated session, returns `{ success: true, user, token }`.
- **`POST /api/auth/logout`**:
  - Invalidates active session and clears auth cookies.
- **`GET /api/auth/me`**: *(Protected by requireAuth)*
  - Restores active user profile from session cookie or `Authorization: Bearer <token>`.

### Task Management (`/api/tasks`)
- **`GET /api/tasks`**: Returns array of saved tasks.
- **`POST /api/tasks`**: `{ "title": "..." }` validates title (<= 500 chars) and persists task.

### Project File Operations (`/api/files`)
- **`GET /api/files/tree`**: Returns filtered hierarchical project directory tree.
- **`GET /api/files/read?path=<relPath>`**: Reads content of allowed source file (< 1MB) with SHA-256 hash.
- **`POST /api/files/diff`**: `{ path, proposedContent }` computes unified patch without modifying disk.
- **`POST /api/files/apply`**: `{ path, content }` *(Protected by requireAuth)* applies changes using atomic temporary write and automatic backup rollback on failure.

### AI Orchestration (`/api/ai`)
- **`GET /api/ai/status`**: Reports configured provider, model name, and readiness without leaking secrets.
- **`POST /api/ai/generate`**: `{ prompt, contextFiles }` *(Protected by aiLimiter)* validates input, queries Groq model with structured JSON schema, computes unified diffs for proposed files, and returns change proposals.

### Editor WebSocket Bridge (`ws://localhost:3001/ws/editor`)
- **`handshake`**: Sent to client upon connection.
- **`ping` / `pong`**: Heartbeat protocol with correlation IDs.
- **`status`**: Queries active editor connections.
- **`open_file`**: `{ payload: { path, line } }` validates path and broadcasts file reveal command to connected editor instances.

---

## 6. Security Architecture

1. **Path Traversal Prevention**:
   All file paths are validated against `projectRoot`. Access is forbidden for:
   - Traversal sequences (`../`, `..\`)
   - Secret/environment files (`.env*`, `*.key`, `*.pem`, `id_rsa`)
   - Dependency folders (`node_modules`, `.git`)
   - Internal state files (`tasks.json`, `users.json`, `sessions.json`)
2. **Password Security**:
   Passwords are never stored in plaintext. They are salted and hashed using `bcryptjs` with 10 salt rounds.
3. **Session Management & CSRF Defense**:
   Sessions use 32-byte cryptographic random tokens. Cookies use `httpOnly`, `sameSite: 'lax'`, and `secure` in production.
4. **CORS Configuration**:
   Explicit whitelist origin matching with `credentials: true`. Arbitrary origins are rejected.
5. **Rate Limiting**:
   - Authentication limiter: 20 requests per 15 minutes per IP.
   - AI generation limiter: 20 requests per minute per IP.
   - General API limiter: 500 requests per 15 minutes.
6. **No Secret Leakage**:
   API keys and database credentials exist exclusively in server environment variables and are never delivered to the client.

---

## 7. Automated Testing & Verification

Run backend integration and security test suite:
```powershell
cd backend
npm test
```
*Tests cover health diagnostics, task CRUD, complete registration/login/me/logout auth flows, path traversal protection, sensitive file blocking, diff calculations, AI status reporting, and WebSocket protocol communication.*

Run frontend linting:
```powershell
cd frontend
npm run lint
```

Run frontend production build:
```powershell
cd frontend
npm run build
```
