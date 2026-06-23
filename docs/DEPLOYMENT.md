# VenCura — Deployment

Four managed hosts, each doing one job. The browser loads the SPA from **Vercel**; Vercel rewrites `/api/*` to
the **Railway** API (also reachable directly). The API is the only thing that talks to **Neon** (Postgres) and
the chain RPC (**Infura**/Sepolia). Pushes to `main` run CI, then Vercel and Railway each auto-deploy their package.

## Topology

```mermaid
graph LR
    Dev(["👤 Developer<br/>push to main"]):::dev --> GH["⚙️ GitHub Actions CI<br/>lint · typecheck · test · build"]:::ci
    User(["🌐 Browser"]):::user

    subgraph VercelBox["▲ Vercel — static hosting"]
        Web["Web SPA<br/>React / Vite build"]:::vercel
    end

    subgraph RailwayBox["🚂 Railway — deployed service"]
        API["NestJS API<br/>+ in-process pollers<br/><i>(runs as a container)</i>"]:::railway
    end

    Neon[("🐘 Neon<br/>Postgres")]:::neon
    Infura["🔗 Infura<br/>Sepolia RPC"]:::infura

    User -->|"load app · HTTPS"| Web
    User -->|"/api/* rewrite · or direct"| API
    Web -.->|"rewrite /api/*"| API
    API -->|"Prisma · TLS"| Neon
    API -->|"viem · JSON-RPC"| Infura
    GH -.->|"deploy on green"| Web
    GH -.->|"deploy on green"| API

    classDef dev fill:#64748b,stroke:#334155,color:#ffffff;
    classDef ci fill:#475569,stroke:#1e293b,color:#ffffff;
    classDef user fill:#0ea5e9,stroke:#0369a1,color:#ffffff;
    classDef vercel fill:#1f2937,stroke:#000000,color:#ffffff;
    classDef railway fill:#8b5cf6,stroke:#6d28d9,color:#ffffff;
    classDef neon fill:#16a34a,stroke:#15803d,color:#ffffff;
    classDef infura fill:#f97316,stroke:#c2410c,color:#ffffff;
    style VercelBox fill:#1f293722,stroke:#94a3b8,stroke-width:1px;
    style RailwayBox fill:#8b5cf622,stroke:#a78bfa,stroke-width:1px;
```

## Hosts

| Host | Runs | Notes |
| --- | --- | --- |
| **Vercel** | `packages/web` static SPA | `/api/*` rewrite → Railway (see [`vercel.json`](../vercel.json)) |
| **Railway** | `packages/api` — deployed service | NestJS + in-process pollers, run as a container; reachable directly at its `*.up.railway.app` URL |
| **Neon** | Postgres | reached via Prisma over TLS (`DATABASE_URL`) |
| **Infura** | Sepolia JSON-RPC | reached via viem (`RPC_URL`) |

The API URL is tied to the Railway **service**, not the project — renaming the project doesn't break it.

## Deploy-time config

Set these in each host's env (they're documented in [`.env.example`](../.env.example)):

- `RPC_URL` — your Infura/Alchemy Sepolia URL (not the local anvil default)
- `CONFIRMATIONS` — `3`–`12` on a public network for reorg safety
- `MASTER_ENCRYPTION_KEY` / `JWT_SECRET` / `ADMIN_API_KEY` — generate with `openssl rand -hex 32`

Secrets come from the environment and are never committed — only `.env.example` (placeholders) is tracked.

## GitHub Environments (auto-created)

The Vercel and Railway GitHub integrations create deployment environments automatically — they aren't defined
in this repo:

- **`Production`** — created by `vercel[bot]`. Vercel hardcodes this name; not configurable.
- **`<project> / production`** — created by `railway-app[bot]`. The first segment is the Railway **project
  name**; rename the project in Railway's dashboard to change it (GitHub recreates the env on next deploy).
