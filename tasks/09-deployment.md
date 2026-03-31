# 09 — Deployment

## Stack on your VPS

```
Coolify (manages everything)
├── Traefik (reverse proxy, HTTPS via Let's Encrypt)
├── PostgreSQL service  ← automation_hub database
└── Next.js service     ← Docker image built by Nixpacks from GitHub
```

---

## Postgres on Coolify

1. Coolify → New Resource → PostgreSQL
2. Set: database name = `automation_hub`, strong password
3. Note the **internal hostname** (e.g. `postgres-automation:5432`) — used by the Next.js container since both are on the same Docker network
4. Note the **external port** — used by the local agent from your machine
5. In VPS firewall (`ufw`), allow port 5432 only from your home IP:
   ```bash
   ufw allow from YOUR_HOME_IP to any port 5432
   ```

---

## Next.js on Coolify (Nixpacks + GitHub)

Since you already have Nixpacks set up, the main additions are:

### `nixpacks.toml` (root of monorepo or apps/web)

```toml
[phases.setup]
nixPkgs = ["nodejs_20"]

[phases.install]
cmds = ["npm install"]

[phases.build]
cmds = ["npm run build"]

[start]
cmd = "node apps/web/.next/standalone/server.js"
```

### `next.config.ts`

```typescript
const nextConfig = {
  output: 'standalone',   // Required for Docker/Nixpacks deployment
}
export default nextConfig
```

### Environment variables in Coolify (Next.js service)

```
DATABASE_URL=postgresql://user:password@postgres-automation:5432/automation_hub
NEXTAUTH_SECRET=<openssl rand -hex 32>
NEXTAUTH_URL=https://your-app.yourdomain.com
GITHUB_CLIENT_ID=<oauth app>
GITHUB_CLIENT_SECRET=<oauth app>
ALLOWED_EMAIL=casper@youremail.com
NODE_ENV=production
```

### Database migrations on deploy

Add a migration step to your build or a one-time command after first deploy:
```bash
# Run from Coolify console or CI
DATABASE_URL=... npx drizzle-kit migrate
```

Or add it to the Nixpacks start command (safe since Drizzle migrations are idempotent):
```toml
[start]
cmd = "npx drizzle-kit migrate && node apps/web/.next/standalone/server.js"
```

### Traefik SSE fix

In the Coolify service settings, add this label to disable response buffering for the SSE route:

```
traefik.http.middlewares.sse-no-buffer.headers.customresponseheaders.X-Accel-Buffering=no
traefik.http.routers.your-service.middlewares=sse-no-buffer
```

Or rely on the `X-Accel-Buffering: no` header set in the Next.js SSE route — both work.

---

## GitHub Actions CI (optional, if you want auto-migration)

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm install
      - run: npx drizzle-kit migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
  # Coolify handles the actual deploy via GitHub webhook — no extra step needed
```

---

## Local agent — startup

### Prerequisites

- Node.js 20+
- ms-365-mcp-server running in SSE mode (or Stdio mode if using SDK directly)
- GitHub PAT with read/write access to repos in better-developers org

### Install

```bash
cd packages/agent
npm install
```

### `.env`

```env
DATABASE_URL=postgresql://user:password@vps.yourdomain.com:5432/automation_hub
ANTHROPIC_API_KEY=sk-ant-...
AGENT_USER_ID=<uuid — find after first login: SELECT id FROM users WHERE email = 'your@email.com'>
ACTIVE_INTEGRATIONS=outlook,teams,github
MS365_MCP_URL=https://xxxx.trycloudflare.com
GITHUB_MCP_URL=https://api.githubcopilot.com/mcp/
GITHUB_TOKEN=github_pat_...
```

### Dev mode

```bash
npm run dev   # tsx watch src/index.ts
```

### Production — macOS launchd

```xml
<!-- ~/Library/LaunchAgents/com.casper.claude-agent.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.casper.claude-agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/casper/claude-automation-hub/packages/agent/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/casper/claude-automation-hub/packages/agent</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/claude-agent.log</string>
  <key>StandardErrorPath</key><string>/tmp/claude-agent.err</string>
</dict>
</plist>
```

```bash
# Build first
npm run build

# Load and start
launchctl load ~/Library/LaunchAgents/com.casper.claude-agent.plist
launchctl start com.casper.claude-agent

# View logs
tail -f /tmp/claude-agent.log
tail -f /tmp/claude-agent.err

# Reload after code change
npm run build && launchctl stop com.casper.claude-agent && launchctl start com.casper.claude-agent
```

### ms-365-mcp-server tunnel (keep running alongside agent)

```bash
# Terminal 1 — MCP server
npx @softeria/ms-365-mcp-server --transport sse --port 3001

# Terminal 2 — Cloudflare tunnel (or add --url to make it persistent)
cloudflared tunnel --url http://localhost:3001
# Copy the https://xxxx.trycloudflare.com URL to MS365_MCP_URL in .env
```

For a stable URL, use a named Cloudflare tunnel instead of the temporary trycloudflare.com URL.

---

## Deployment checklist

### VPS / Coolify
- [ ] Postgres service created, `automation_hub` database exists
- [ ] VPS firewall allows port 5432 from home IP only
- [ ] Next.js service created, connected to GitHub repo
- [ ] All env vars set in Coolify
- [ ] `next.config.ts` has `output: 'standalone'`
- [ ] First deploy successful, app is live at your domain
- [ ] Migrations run: `npx drizzle-kit migrate`
- [ ] Login works (GitHub OAuth → redirects back to board)

### Local agent
- [ ] `.env` filled in
- [ ] `AGENT_USER_ID` set (query Postgres after first login)
- [ ] ms-365-mcp-server running + tunnel active
- [ ] `MS365_MCP_URL` set to tunnel URL
- [ ] `npm run dev` starts without errors
- [ ] Agent shows "Online" in board header
- [ ] At least one trigger configured and "Run now" produces a card
- [ ] launchd plist installed for auto-start on login
