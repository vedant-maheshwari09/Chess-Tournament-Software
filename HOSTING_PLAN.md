# Chess Tournament Software Hosting Migration Plan (Render Free Tier)

This plan focuses on **Render**, which allows you to deploy your full stack for **$0/mo** without providing credit card information.

## 1. The Render Stack

| Layer | Provider | Tier | Why? |
| :--- | :--- | :--- | :--- |
| **Full Stack** | **Render** | Free ($0) | **Easiest Option**: No credit card required. Handles Node.js/Express and serves the React frontend. |
| **Database/Auth** | **Supabase** | Free ($0) | Already in use. |

---

## 2. Prepare for Render Deployment
- [x] **Fix Build Errors**: The `No matching export` errors for `calculateMatchupScore`, `getMatchFormat`, and `isMatchDecided` have been resolved.
- [x] **Verify Build**: Local build `npm run build` now completes successfully.
- [ ] **GitHub Push**: Commit and push the latest changes to your GitHub repository.

---

## 3. Managing "Loading Issues"
*   **The Problem**: Render's free tier "spins down" after 15 minutes of no traffic.
*   **The Symptom**: The first visitor after a break will see a loading screen for 30-60 seconds.
*   **The Fix**: For a production tournament, you can eventually upgrade to the "Starter" tier ($7/mo) to keep it always on, or use a free "ping" service (like Cron-job.org) to keep it awake during tournament hours.

---

## 4. How to Deploy to Render

### Step 1: Create a New Web Service
1. Log in to [dashboard.render.com](https://dashboard.render.com/).
2. Click **"New +"** > **"Web Service"**.
3. Connect your GitHub repository.

### Step 2: Configure Build & Runtime
*   **Name**: `chess-tournament-manager` (or your choice)
*   **Runtime**: `Node`
*   **Build Command**: `npm install && npm run build`
*   **Start Command**: `npm start`

### Step 3: Environment Variables
Go to the **"Environment"** tab and add:
- `PORT`: `5010`
- `DATABASE_URL`: (From Supabase)
- `SUPABASE_URL`: (From Supabase)
- `SUPABASE_SERVICE_ROLE_KEY`: (From Supabase)
- `SESSION_SECRET`: (A random secure string)
- `NODE_ENV`: `production`

---

## 5. Supabase URL Configuration
Once the Render deployment is live (it will give you a URL like `https://chess-app.onrender.com`):
1. Go to **Supabase Dashboard** > **Authentication** > **URL Configuration**.
2. **Site URL**: Set to your new Render URL.
3. **Redirect URLs**: Add the Render URL to the list.

---

## 6. Local Status
*   **Port 5010**: Terminated and available for local use.
*   **Knockout Bracket**: Verified functional and type-safe.
*   **Build Status**: Production build is fixed and ready for Render.
