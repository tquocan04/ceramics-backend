# Ceramics Pipeline — Backend

REST API backend for a ceramics factory production pipeline. It accepts production orders described in natural language, runs an AI analysis step to extract technical specifications, converts confirmed orders into production batches with a 7-stage workflow engine, and broadcasts alerts through a Telegram bot using the Transactional Outbox pattern.

```
Frontend ──HTTP──▶ Backend (Express) ──Prisma──▶ PostgreSQL
                        │
                        ├──LLM──▶ AI analysis (currently mocked)
                        └──Bot API──▶ Telegram notifications
```

## Tech Stack

| Layer      | Technology                          |
| ---------- | ----------------------------------- |
| Runtime    | Node.js ≥ 20 (tested on Node 22)    |
| Framework  | Express 5                           |
| Language   | TypeScript (strict mode)            |
| ORM        | Prisma 5                            |
| Database   | PostgreSQL 17                       |
| Messaging  | Telegram Bot API (native `fetch`)   |
| Dev tools  | tsx, nodemon, Docker multi-stage    |

## Requirements

- **Node.js ≥ 20** and npm
- **Docker + Docker Compose** (recommended — provides PostgreSQL and the API container)
- A **Telegram bot token** and **chat ID** (see [Telegram Setup](#telegram-setup)) — optional, the app runs without them and skips delivery

## Project Structure

```
backend/
├── prisma/
│   └── schema.prisma          # Data model: orders, AI analyses, batches,
│                              # stages, QC reports, workflow events, notifications
├── src/
│   ├── app.ts                 # Express app + route registration
│   ├── server.ts              # HTTP bootstrap
│   ├── core/
│   │   ├── db.ts              # PrismaClient singleton (hot-reload safe)
│   │   └── ai-schema.ts       # Zod schema for AI analysis results
│   ├── routes/
│   │   ├── health.routes.ts
│   │   ├── order.routes.ts
│   │   ├── batch.routes.ts
│   │   └── notification.routes.ts
│   ├── controllers/           # Map domain errors → HTTP status codes
│   │   ├── order.controller.ts
│   │   ├── batch.controller.ts
│   │   └── notification.controller.ts
│   ├── services/
│   │   ├── order.service.ts         # Create / analyze / confirm order
│   │   ├── workflow.service.ts      # Stage state machine (start/complete/fail)
│   │   ├── notification.service.ts  # Transactional Outbox + Telegram dispatch
│   │   └── ai.service.ts            # LLM extraction (mocked stub)
│   └── repositories/
│       └── order.repository.ts      # Order persistence layer
├── docker-compose.yml         # PostgreSQL 17 + API service
├── Dockerfile                 # Multi-stage production build
└── .env.example               # Environment variable template
```

## Getting Started

### 1. Configure environment

Copy `.env.example` to `.env` and fill in the values:

| Variable             | Description                                        | Example                                                        |
| -------------------- | -------------------------------------------------- | -------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string                       | `postgresql://ceramics:ceramics@localhost:5433/ceramics?schema=public` |
| `PORT`               | HTTP port                                          | `5000`                                                          |
| `TELEGRAM_BOT_TOKEN` | Token from [@BotFather](https://t.me/BotFather)    | `123456:ABC-DEF...`                                             |
| `TELEGRAM_CHAT_ID`   | Target chat/group ID for notifications             | `-1001234567890`                                                |

> When running through Docker Compose, database credentials are managed by the compose file — only the two Telegram variables need to be set.

### 2A. Run with Docker (recommended)

Starts PostgreSQL and the API together. The API container applies the Prisma schema automatically before booting.

```bash
docker compose up --build
```

- API: `http://localhost:5000`
- PostgreSQL exposed on host port `5433`

### 2B. Run locally

```bash
npm install

# Start PostgreSQL only (from docker-compose.yml)
docker compose up -d db

# Push the Prisma schema to the database
npx prisma db push

# Start in watch mode
npm run dev
```

### Production build (without Docker)

```bash
npx tsc --outDir dist --rootDir src
node dist/server.js
```

## Useful Scripts

| Script               | Command                  | Purpose                              |
| -------------------- | ------------------------ | ------------------------------------ |
| `npm run dev`        | `tsx watch src/server.ts`| Development server with hot reload   |
| `npm run build`      | `tsc`                    | Type-check + emit                    |
| `npm run db:push`    | `prisma db push`         | Sync schema to database              |
| `npm run db:studio`  | `prisma studio`          | Browse data in a GUI                 |
| `npm run test:db`    | `tsx src/test-db.ts`     | Verify database connectivity         |

## API Reference

Base URL: `http://localhost:5000/api`

All errors share one shape:

```json
{
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable message"
  }
}
```

### Health

| Method | Endpoint       | Description        |
| ------ | -------------- | ------------------ |
| `GET`  | `/health`      | Liveness probe     |

### Orders

| Method | Endpoint           | Description                                    |
| ------ | ------------------ | ---------------------------------------------- |
| `POST` | `/orders`          | Create a draft order from a raw description    |
| `POST` | `/orders/:id/analyze` | Run AI extraction on the raw description    |
| `POST` | `/orders/:id/confirm` | Confirm specs → creates batch + 7 stages    |

**Create order**

```bash
curl -X POST http://localhost:5000/api/orders \
  -H "Content-Type: application/json" \
  -d '{ "raw_description": "200 lotus-pattern ceramic vases, celadon glaze, 35cm tall, fired at 1280°C, done within 10 days." }'
```

Status flow: `DRAFT → AI_ANALYZING → PENDING_CONFIRMATION | AI_ANALYSIS_FAILED → CONFIRMED`.
Re-running analyze is allowed until the order is confirmed.

**Confirm order** (idempotent — returns the existing batch if already created). Optional manager overrides are deep-merged on top of the AI result:

```json
{
  "priority": "URGENT",
  "deadline": "2026-09-01T00:00:00.000Z",
  "spec": {
    "extracted": { "quantity": 250 },
    "estimated": { "clay_kg": 500 }
  }
}
```

Response contains the updated order, the created batch (`GOM-XXXX`) and its stages.

### Batches / Workflow Engine

Stages always follow the fixed sequence:
`FORMING → DRYING → DECORATING → GLAZING → FIRING → QUALITY_CHECK → PACKAGING`

| Method | Endpoint                                  | Description                     |
| ------ | ----------------------------------------- | ------------------------------- |
| `POST` | `/batches/:id/stages/:stage/start`        | Start a pending stage           |
| `POST` | `/batches/:id/stages/:stage/complete`     | Complete the running stage      |
| `POST` | `/batches/:id/stages/:stage/fail`         | Report a failure → blocks batch |

`:stage` is case-insensitive, e.g. `forming`, `QUALITY_CHECK`.

Enforced business rules:

- A stage can only start when its previous stage is `COMPLETED` (no skipping).
- Only one stage may be `IN_PROGRESS` at a time.
- Completing requires the stage to be `IN_PROGRESS`; completing twice is idempotent.
- A failed stage marks the whole batch `BLOCKED`.
- Every transition writes an immutable `WorkflowEvent` audit record.

Optional JSON bodies:

```json
// start / complete
{ "note": "Optional worker note" }

// fail
{ "reason": "Kiln lost power" }
```

Example — full happy path:

```bash
curl -X POST http://localhost:5000/api/batches/<batchId>/stages/forming/start
curl -X POST http://localhost:5000/api/batches/<batchId>/stages/forming/complete
curl -X POST http://localhost:5000/api/batches/<batchId>/stages/drying/start
curl -X POST http://localhost:5000/api/batches/<batchId>/stages/drying/fail \
  -H "Content-Type: application/json" -d '{ "reason": "Kiln door seal broken" }'
```

The last call marks `DRYING` as `FAILED` and sets the whole batch to `BLOCKED`, triggering an emergency Telegram alert.

### Notifications (Outbox)

| Method | Endpoint                | Description                                      |
| ------ | ----------------------- | ------------------------------------------------ |
| `GET`  | `/notifications`        | List the 200 most recent outbox records          |
| `POST` | `/notifications/trigger`| Broadcast a custom alert or completion message   |
| `POST` | `/notifications/:id/retry` | Redeliver a failed record (same row, no duplicates) |

Each record carries `status: PENDING | SENT | FAILED`, `retryCount` and `errorMessage`. Telegram failures never roll back production operations.

**Custom trigger**

```json
{
  "title": "Kiln maintenance",
  "message": "Kiln #2 offline for 2 hours",
  "level": "WARNING",
  "batchId": "optional-batch-uuid"
}
```

- `level`: `INFO | WARNING | CRITICAL` (controls the icon/event severity)
- Shortcut form: `{ "type": "BATCH_COMPLETED", "batchCode": "GOM-0001", "productName": "...", "quantity": 200 }`

## Error Codes

| Code                          | HTTP | Meaning                                   |
| ----------------------------- | ---- | ----------------------------------------- |
| `EMPTY_DESCRIPTION`           | 422  | Order description missing/invalid         |
| `ORDER_NOT_FOUND`             | 404  | Unknown order id                          |
| `ORDER_ALREADY_CONFIRMED`     | 409  | Re-analysis after confirmation denied     |
| `ORDER_NOT_ANALYZED`          | 409  | Confirm before a valid AI analysis        |
| `ORDER_CANNOT_BE_CANCELLED`   | 409  | Order is cancelled                        |
| `VALIDATION_FAILED`           | 422  | Invalid quantity/spec override            |
| `BATCH_NOT_FOUND` / `STAGE_NOT_FOUND` | 404 | Unknown batch/stage                |
| `PREVIOUS_STAGE_NOT_COMPLETED`| 409  | Stage skipping attempt                    |
| `ANOTHER_STAGE_IN_PROGRESS`   | 409  | Concurrent active stage                   |
| `STAGE_ALREADY_IN_PROGRESS` / `STAGE_ALREADY_COMPLETED` / `STAGE_NOT_STARTED` | 409 | Invalid transition |
| `BATCH_CANCELLED` / `BATCH_BLOCKED` | 409 | Batch not operable                   |
| `INTERNAL_ERROR`              | 500  | Unhandled server error                    |

## Telegram Setup

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → copy the **token** into `TELEGRAM_BOT_TOKEN`.
2. Send any message to your bot, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy the `chat.id` into `TELEGRAM_CHAT_ID`.
3. Restart the API. Without these variables the service logs a warning and stores notifications as `PENDING` instead of sending.

Delivery follows the **Transactional Outbox** pattern: every message is persisted first (`PENDING`), then dispatched, then marked `SENT` or `FAILED` with an incremented retry counter. The dispatcher never throws — a Telegram outage can never crash or roll back workflow operations.

## Domain Model

```
ProductionOrder 1───* AIAnalysis        (every attempt persisted, latest linked back)
ProductionOrder 1───1 ProductionBatch   (created on confirm)
ProductionBatch 1───7 ProductionStage   (fixed sequence, unique per batch+type)
ProductionBatch 1───* QCReport ──* QCDefect
WorkflowEvent  (immutable audit trail for orders/batches)
Notification   (outbox row linked to a WorkflowEvent)
```

## Current Limitations

- **AI extraction is a mocked stub** (`ai.service.ts`) returning deterministic sample data; the real LLM integration lives in the separate `ai-core` Python service.
- Read/list endpoints for orders and batches, order cancellation, the QC submission flow, and realtime event streaming are not implemented yet.
- No authentication/RBAC — intended for MVP/demo environments only.
