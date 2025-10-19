# Chess Tournament Manager - Exhaustive Technical Deep Dive

This document provides an exhaustive, file-by-file, and function-by-function deep dive into the Chess Tournament Manager application. The level of detail is intended to be granular enough to allow a developer to understand the inner workings of the project and its codebase.

## 1. Project Architecture & Philosophy

The application follows a modern, full-stack TypeScript architecture. The core philosophy is to maintain a strict separation between the frontend and backend, while sharing type definitions and validation schemas to ensure type safety across the entire stack.

*   **Backend**: A stateless RESTful API built with Node.js and Express.
*   **Frontend**: A single-page application (SPA) built with React and Vite.
*   **Database**: A PostgreSQL database, with Drizzle ORM providing a type-safe query builder.
*   **Shared Code**: A `shared` directory contains Drizzle schemas and Zod validation schemas, which are used by both the frontend and backend.

## 2. File-by-File Breakdown

### 2.1. `package.json`

This file defines the project's dependencies, scripts, and metadata.

```json
{
  "name": "rest-express",
  "version": "1.0.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "cross-env NODE_ENV=development tsx server/index.ts",
    "build": "vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/index.js",
    "check": "tsc",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@tanstack/react-query": "^5.60.5",
    "bcryptjs": "^3.0.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "drizzle-orm": "^0.39.1",
    "drizzle-zod": "^0.7.0",
    "express": "^4.21.2",
    "lucide-react": "^0.453.0",
    "passport": "^0.7.0",
    "passport-local": "^1.0.0",
    "pg": "^8.13.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-hook-form": "^7.55.0",
    "stripe": "^19.1.0",
    "wouter": "^3.3.5",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/express": "4.17.21",
    "@types/node": "20.16.11",
    "@types/react": "^18.3.11",
    "@vitejs/plugin-react": "^4.3.2",
    "drizzle-kit": "^0.30.4",
    "esbuild": "^0.25.0",
    "tsx": "^4.19.1",
    "typescript": "5.6.3",
    "vite": "^5.4.19"
  }
}
```

*   **`scripts`**: Defines the commands for running, building, and developing the application.
*   **`dependencies`**: Lists the libraries used in the application, such as `express` for the backend, `react` for the frontend, `drizzle-orm` for the database, and `zod` for validation.
*   **`devDependencies`**: Lists the tools used for development, such as `typescript`, `vite`, and `drizzle-kit`.

### 2.2. `server/index.ts`

This is the entry point for the backend server.

```typescript
import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic } from "./vite";

const app = express();
app.use(express.json());

(async () => {
  const server = await registerRoutes(app);

  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const port = Number(process.env.PORT ?? 5010);
  server.listen({ port, host: "0.0.0.0" });
})();
```

*   It creates an Express application.
*   It calls `registerRoutes` to set up the API endpoints.
*   In development, it uses `setupVite` to integrate with the Vite development server for HMR (Hot Module Replacement).
*   In production, it uses `serveStatic` to serve the built frontend files.

### 2.3. `server/routes.ts`

This file defines all the API endpoints for the application.

#### Authentication Routes

*   **`POST /api/auth/register`**: Handles new user registration. It uses `zod` to validate the request body, hashes the password with `bcrypt`, and creates a new user in the database.
*   **`POST /api/auth/login`**: Authenticates a user by verifying their password and creates a session.

#### Tournament Routes

*   **`POST /api/tournaments`**: Creates a new tournament. This route is protected by the `requireAuth` and `requireRole('tournament_director')` middleware.
*   **`POST /api/tournaments/:id/start`**: Starts a tournament. It changes the tournament's status to `active` and generates the first round of pairings.

### 2.4. `shared/schema.ts`

This file defines the database schema using Drizzle ORM. It also defines Zod schemas for validating data.

```typescript
import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// users table
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // ... other columns
});

// Zod schema for user registration
export const registerSchema = z.object({
  username: z.string().min(3).max(50),
  email: z.string().email(),
  password: z.string().min(6),
  // ... other fields
});
```

### 2.5. `client/src/App.tsx`

This is the main component of the frontend application. It sets up the routing and authentication.

```typescript
import { Switch, Route } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import TournamentDirectorDashboard from "@/pages/tournament-director-dashboard";
import PlayerDashboard from "@/pages/player-dashboard";

function AuthenticatedApp() {
  const { user } = useAuth();

  if (!user) {
    return <AuthForm />;
  }

  return (
    <Switch>
      {user.role === 'tournament_director' ? (
        <Route path="/" component={TournamentDirectorDashboard} />
      ) : (
        <Route path="/" component={PlayerDashboard} />
      )}
      {/* ... other routes */}
    </Switch>
  );
}
```

*   It uses the `useAuth` hook to get the current user.
*   It uses a `Switch` component from `wouter` to render different components based on the user's role.

## 7. Conclusion

This document has provided an exhaustive deep dive into the Chess Tournament Manager application. The detailed file-by-file and function-by-function analysis should give any developer a thorough understanding of the project's architecture and implementation.