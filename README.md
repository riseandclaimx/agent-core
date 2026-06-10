# Agent Core - Autonomous Slack Agent

A production-grade autonomous agent running on Cloudflare Workers with multi-model reasoning, persistent memory, and full Slack integration.

## Architecture

```
Slack (UI) → Cloudflare Worker (Router) → Hybrid Agent (Plan → ReAct) → Tools/Memory/Queue
                                                              ↓
PostgreSQL (Neon/Supabase) ← pgvector memories, tasks, logs, analytics
                                                              ↓
Upstash/QStash ← Async task queue, rate limiting, distributed locks
```

## Features

- **Hybrid Reasoning**: Plan → Execute for complex tasks, ReAct for simple ones
- **Multi-Model Routing**: 11 models (Groq, DeepSeek, Gemini, OpenAI, Anthropic, Cerebras)
- **Persistent Memory**: pgvector semantic search + global/user/channel scoping
- **Full Slack UI**: Slash commands, modals, shortcuts, block actions, file handling
- **Async Tasks**: Background job queue with retries, scheduling, progress tracking
- **Observability**: Structured logging, metrics, tracing, cost tracking
- **Security**: Request verification, rate limiting, encryption, audit logs

## Quick Start

### Prerequisites

- Node.js 22+
- Cloudflare account (Workers, KV, D1 optional)
- Neon or Supabase PostgreSQL with pgvector
- Upstash Redis + QStash
- Slack App (Bot token, Signing secret, App token for Socket Mode)

### Installation

```bash
cd agent-core
npm install
```

### Configuration

Copy `wrangler.toml` and set secrets:

```bash
wrangler secret put DATABASE_URL
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put SLACK_APP_TOKEN
wrangler secret put UPSTASH_REDIS_REST_URL
wrangler secret put UPSTASH_REDIS_REST_TOKEN
wrangler secret put GROQ_API_KEY
wrangler secret put ENCRYPTION_KEY  # Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Optional model keys:
```bash
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GEMINI_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put CEREBRAS_API_KEY
```

### Database Setup

```bash
# Generate migrations
npm run db:generate

# Run migrations
npm run db:migrate
```

### Development

```bash
# Start local dev server
npm run dev

# In another terminal, expose with ngrok for Slack
ngrok http 8788
```

Update Slack App URLs:
- Request URL: `https://your-ngrok.ngrok.io/slack/events`
- Slash Commands: `https://your-ngrok.ngrok.io/slack/commands`
- Interactivity: `https://your-ngrok.ngrok.io/slack/interactions`

### Deploy

```bash
npm run deploy
```

## Slack Commands

| Command | Description |
|---------|-------------|
| `/agent <request>` | Ask the agent anything |
| `/ask <request>` | Alias for /agent |
| `/task create <name> [desc]` | Create a background task |
| `/task status <id>` | Check task status |
| `/task cancel <id>` | Cancel a task |
| `/tasks` | List your tasks |
| `/memory search <query>` | Search memories |
| `/memory write <content>` | Save a memory |
| `/remember <content>` | Quick save to memory |
| `/recall <query>` | Quick memory search |
| `/agent-status` | System status |
| `/agent-help` | Show help |

## Global Shortcuts

- **Create Task** - Modal for task creation
- **Search Memories** - Modal for semantic search
- **Agent Help** - Interactive help modal

## Message Shortcuts

- **Summarize Thread** - Generate thread summary
- **Create Task from Message** - Turn message into task
- **Remember Message** - Save message to memory

## Project Structure

```
src/
├── index.ts              # Worker entry point
├── agent/
│   ├── core.ts           # Main agent (Plan → ReAct)
│   ├── planner.ts        # Task planning
│   ├── reactor.ts        # ReAct loop
│   ├── memory.ts         # pgvector memory system
│   ├── router/           # Model routing & cost tracking
│   └── tools/            # Tool registry & execution
├── slack/
│   ├── app.ts            # Bolt app setup
│   ├── handlers/         # Commands, events, shortcuts, modals
│   └── middleware/       # Auth, context, rate limiting
├── db/
│   ├── client.ts         # Drizzle + Postgres
│   └── schema/           # Memory, tasks, logs, users
├── queue/
│   └── upstash.ts        # QStash + Redis integration
├── models/               # Model provider clients
├── obs/                  # Logging, metrics, tracing
└── utils/                # Crypto, IDs, Slack formatting
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SLACK_SIGNING_SECRET` | Yes | Slack app signing secret |
| `SLACK_BOT_TOKEN` | Yes | xoxb- bot token |
| `SLACK_APP_TOKEN` | No | xapp- for Socket Mode |
| `UPSTASH_REDIS_REST_URL` | Yes | Upstash Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Yes | Upstash Redis token |
| `QSTASH_URL` | No | QStash URL (defaults to Upstash) |
| `QSTASH_TOKEN` | No | QStash token |
| `GROQ_API_KEY` | Yes | Groq API key (primary model) |
| `ENCRYPTION_KEY` | Yes | Base64 32-byte key for memory encryption |
| `WORKER_URL` | Yes | Worker URL for QStash callbacks |

## Model Routing

The router selects models based on:
- Task type (coding → DeepSeek, reasoning → DeepSeek Reasoner, general → Groq)
- Complexity (low → 8B, high → 70B+)
- Tool requirements (tool use → Groq gpt-oss-20b)
- Context length (long → Gemini 1.5M)
- Cost limits (free tier → Groq/Cerebras, premium → Claude/GPT-4o)

Configure in `src/agent/router/policies.json`.

## Adding Tools

1. Add definition to `src/agent/tools/definitions.ts`
2. Register handler in `src/agent/tools/registry.ts`
3. Tool is automatically available to agent

Tools are namespaced: `memory.*`, `auth.*`, `task.*`, `log.*`, `email.*`, `storage.*`, `web.*`, `business.*`, `security.*`, `router.*`

## MCP Integration (Future)

The tool abstraction layer is MCP-ready. To add MCP server:
1. Create MCP server exposing same tool namespaces
2. Update `src/agent/tools/executor.ts` to call MCP instead of direct handlers
3. Deploy MCP server to Fly.io or similar

## Monitoring

- **Logs**: Structured JSON in PostgreSQL + console
- **Metrics**: `/metrics` endpoint (Prometheus format)
- **Tracing**: Trace IDs propagated through all operations
- **Costs**: Per-request, per-user, per-team tracking

## License

MIT