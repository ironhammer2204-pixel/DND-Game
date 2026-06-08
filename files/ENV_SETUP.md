# ═══════════════════════════════════════════════════════════
# ENVIRONMENT VARIABLE SETUP FOR VERCEL + CLOUDFLARE TUNNEL
# ═══════════════════════════════════════════════════════════

## 1. Server Environment Variables (.env or hosting platform)

# REQUIRED: Must match your Vercel frontend URL exactly
FRONTEND_URL=https://ironhammer.vercel.app

# Alternative names (if referenced elsewhere in config)
CLIENT_ORIGIN=https://ironhammer.vercel.app
VITE_APP_URL=https://ironhammer.vercel.app

# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...

# Groq AI
GROQ_API_KEY=gsk_...

# Server port
PORT=3001


## 2. Frontend Environment Variables (Vercel + local .env)

# .env.production (for Vercel builds)
VITE_API_URL=https://your-tunnel.trycloudflare.com
VITE_WS_URL=wss://your-tunnel.trycloudflare.com
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# .env.development (for local dev)
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001


## 3. Supabase Dashboard Configuration

Go to: https://supabase.com/dashboard/project/_/auth/url-configuration

### Site URL:
https://ironhammer.vercel.app

### Redirect URLs (ADD ALL OF THESE):
- https://ironhammer.vercel.app/auth/callback
- http://localhost:5173/auth/callback
- http://localhost:3001/auth/callback
- https://your-tunnel.trycloudflare.com/auth/callback

### IMPORTANT: If you restart Cloudflare Tunnel, the URL changes!
Unless you are using a named tunnel with a custom domain, every time you start a quick tunnel, you will get a new random URL.
When this happens, you MUST:
1. Add the new `https://<random>.trycloudflare.com/auth/callback` to your Supabase Redirect URLs list.
2. Update the `VITE_API_URL` and `VITE_WS_URL` env vars in Vercel to use the new tunnel URL.
3. Redeploy your frontend on Vercel so it points to the new backend endpoint.


## 4. Cloudflare Tunnel Launch Command

To expose your local port `3001` (backend port) via a Cloudflare Tunnel:

### Option A: Using the official cloudflared CLI (Recommended)
If you have `cloudflared` installed:
```bash
cloudflared tunnel --url http://localhost:3001
```

### Option B: Using quick tunnel via npx
If you do not have the CLI installed globally, you can run a temporary tunnel:
```bash
npx --yes localtunnel --port 3001
# Or use cloudflared npm package if available:
npx @cloudflare/next-on-pages tunnel --port 3001
```

*(Note: Cloudflare Tunnels do not show any warning page/browser interstitial by default, so you do not need special headers to bypass them like Pinggy/Ngrok did, though they remain supported in our code).*


## 5. Vercel Deployment Settings

In your Vercel project dashboard:
1. Go to Settings → Environment Variables.
2. Add all `VITE_*` variables from step 2.
3. Make sure the "Production" environment is checked.
4. Trigger a new deployment after updating the variables.


## 6. Quick Test Commands

# Test if your backend is reachable through the tunnel:
curl -H "Accept: application/json" https://your-tunnel.trycloudflare.com/api/auth/google?redirect_to=https://ironhammer.vercel.app/auth/callback

# Should return JSON: {"url": "https://...", "redirectTo": "..."}
