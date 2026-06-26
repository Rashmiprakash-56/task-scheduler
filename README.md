# Task Scheduler

![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-4.x-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

> A production-style, horizontally scalable distributed task queue built with **Node.js (Express)**, **PostgreSQL**, and **Redis** — supporting job priority queues, scheduled/delayed execution, a dead-letter queue with retry, a distributed circuit breaker, IP-based rate limiting, and Prometheus-compatible metrics. Fully containerized with Docker Compose.

This project implements the core mechanics behind real-world job queue systems (think Sidekiq, Celery, or AWS SQS + Lambda) from scratch, to demonstrate hands-on understanding of concurrency control, distributed systems trade-offs, and backend reliability patterns.

---

## Highlights / Skills Demonstrated

- **REST API design** with Express.js — resource-oriented endpoints, pagination, filtering, structured error responses
- **Concurrency-safe job processing** at the database level using PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED`, allowing multiple worker processes to consume the same queue without double-processing a job
- **Distributed systems patterns**: dead-letter queue (DLQ) with manual replay, circuit breaker (closed/open/half-open) shared across processes via Redis, stale-job recovery ("reaper") for crashed workers
- **Redis as a multi-purpose infrastructure component**: `LPUSH`/`BRPOP` priority queues, Sorted Sets for delayed/scheduled jobs, `INCR`/`EXPIRE` for rate limiting
- **Horizontal scalability** — stateless API and worker processes; scaling is just adding replicas (`docker-compose.yml` runs multiple worker containers by default)
- **Observability**: structured JSON logging and a `/metrics` endpoint in Prometheus exposition format
- **Containerization**: multi-service Docker Compose setup (Postgres, Redis, API, Worker) with healthchecks
- **Automated testing** with Node's built-in test runner (`node:test`), covering rate limiting, circuit breaker state transitions, job handlers, and API routes

**Keywords:** Node.js, Express.js, REST API, PostgreSQL, Redis, Docker, Docker Compose, microservices, distributed systems, concurrency control, row-level locking, message queue, job queue, task scheduler, priority queue, dead-letter queue, circuit breaker pattern, rate limiting, horizontal scaling, Prometheus, structured logging, backend engineering, system design.

---

## Architecture

```text
                       Client
                          |
                Express API + Rate Limiter
                  (Redis-backed, fail-open)
                          |
        +-----------------+------------------+
        |                                    |
        v                                    v
   PostgreSQL                             Redis
 (source of truth:                  (queues: jobs:high/normal/low,
  jobs + dead_letter_queue)          jobs:delayed ZSET, rate-limit
        ^                            keys, circuit-breaker state)
        |                                    |
        |                                    v
        +-------------------------- Worker 1, Worker 2, ... N
                              (BRPOP + Postgres SKIP LOCKED)
```

| Component | Responsibility |
|---|---|
| **API (Express)** | Create/list/cancel jobs, browse & retry DLQ entries, expose `/metrics` |
| **PostgreSQL** | Durable source of truth for job state, attempts, results, and the DLQ |
| **Redis** | Fast transport layer — priority queues, delayed-job sorted set, rate-limit counters, circuit-breaker state |
| **Worker** | Pulls jobs from Redis, claims them safely in Postgres, executes the handler, updates state |
| **Scheduler** (in-worker loop) | Promotes due delayed jobs from the Redis sorted set into the active queues |
| **Reaper** (in-worker loop) | Recovers jobs stuck in `running` if a worker crashes mid-execution |

---

## Project Structure

```
task-scheduler/
├── app/
│   ├── index.js        # Express app entrypoint
│   ├── routes.js        # Job & DLQ REST endpoints
│   ├── rateLimit.js     # Redis-backed IP rate limiter middleware
│   ├── metrics.js        # /metrics endpoint (Prometheus format)
│   └── db.js             # PostgreSQL connection pool
├── worker/
│   ├── worker.js          # Main worker loop (BRPOP + job claiming)
│   ├── scheduler.js       # Promotes delayed jobs to active queues
│   ├── reaper.js          # Recovers stale "running" jobs
│   └── handlers.js        # Job-type handlers (fibonacci, sleep, email, webhook)
├── lib/
│   ├── redis.js           # Shared ioredis client
│   ├── circuitBreaker.js  # Distributed circuit breaker (Redis-backed)
│   ├── logger.js          # JSON structured logger
│   └── constants.js       # Priorities, max attempts, valid job types
├── tests/                 # node:test suites (routes, rate limit, circuit breaker, handlers)
├── init.sql               # Postgres schema (jobs + dead_letter_queue)
├── docker-compose.yml      # Postgres, Redis, API, Worker (multi-replica)
├── Dockerfile.app
├── Dockerfile.worker
└── package.json
```

---

## Database Schema

**`jobs`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID (PK) | Auto-generated |
| `type` | VARCHAR(50) | One of `fibonacci`, `sleep`, `email`, `webhook` |
| `payload` | JSONB | Job-specific input |
| `status` | VARCHAR(20) | `queued` → `scheduled` → `running` → `succeeded` \| `failed` \| `cancelled` |
| `priority` | INT | `0` low, `1` normal, `2` high |
| `run_at` | TIMESTAMP | When the job should run (for delayed jobs) |
| `attempts` | INT | Retry counter (max 3 before moving to DLQ) |
| `result` | JSONB | Output of a successful run |
| `error` | TEXT | Last error message |
| `locked_by` / `locked_at` | VARCHAR / TIMESTAMP | Which worker currently owns the job, and since when |
| `cancelled` | BOOLEAN | Soft-cancel flag checked by workers before execution |

**`dead_letter_queue`** — `id`, `job_id`, `type`, `payload`, `error`, `attempts`, `failed_at`. Holds jobs that exhausted their retries, for inspection and manual replay via `POST /dlq/:id/retry`.

---

## Getting Started (Local Setup)

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/) (v2+)
- Ports `3000`, `5432`, and `6379` free on your machine
- (Optional, for running outside Docker) Node.js 20+

### 1. Clone the repo
```bash
git clone https://github.com/Rashmiprakash-56/task-scheduler.git
cd task-scheduler
```

### 2. (Optional) Configure environment variables
The defaults in `docker-compose.yml` work out of the box. To override them, create a `.env` file in the project root:
```env
POSTGRES_USER=scheduler
POSTGRES_PASSWORD=scheduler
POSTGRES_DB=scheduler
```

| Variable | Default | Used by |
|---|---|---|
| `PORT` | `3000` | API |
| `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE` | see compose file | API, Worker |
| `REDIS_HOST` / `REDIS_PORT` | `redis` / `6379` | API, Worker |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `scheduler` | Postgres container |

### 3. Build and start everything
```bash
docker compose up --build
```
This starts:
- PostgreSQL (with `init.sql` applied automatically on first boot)
- Redis
- 1 API instance on `localhost:3000`
- Multiple Worker instances (replica count set in `docker-compose.yml`)

Wait for the logs to show `API server listening on port 3000` — Postgres and Redis have healthchecks, so the API/Worker containers will wait for them automatically.

### 4. Verify it's running
```bash
curl http://localhost:3000/metrics
```
You should get a Prometheus-format text response with `jobs_total`, `jobs_by_type`, `jobs_dlq_total`, and `redis_queue_length` metrics.

### 5. Try the API

**Create a high-priority job**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "fibonacci", "payload": {"n": 10}, "priority": "high"}'
```

**Create a scheduled/delayed job**
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "sleep", "payload": {"ms": 3000}, "run_at": "2026-12-31T23:59:59Z"}'
```

**List jobs (pagination & filtering)**
```bash
curl "http://localhost:3000/jobs?status=succeeded&priority=high&page=1&limit=5"
```

**Get a single job's status**
```bash
curl http://localhost:3000/jobs/<job-id>
```

**Cancel a queued/scheduled job**
```bash
curl -X DELETE http://localhost:3000/jobs/<job-id>
```

**View the dead-letter queue**
```bash
curl "http://localhost:3000/dlq?page=1&limit=20"
```

**Retry a job from the DLQ**
```bash
curl -X POST http://localhost:3000/dlq/<dlq-entry-id>/retry
```

### 6. Stop everything
```bash
docker compose down          # stop containers
docker compose down -v       # also wipe the Postgres volume (clean slate)
```

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/jobs` | Create a job (`type`, `payload`, optional `priority`, optional `run_at`) |
| `GET` | `/jobs` | List jobs — supports `status`, `type`, `priority`, `page`, `limit`, `sort`, `order` |
| `GET` | `/jobs/:id` | Fetch a single job's full state |
| `DELETE` | `/jobs/:id` | Cancel a queued/scheduled job (404 if missing, 409 if running, 400 if already finished) |
| `GET` | `/dlq` | List dead-lettered jobs (paginated) |
| `POST` | `/dlq/:id/retry` | Requeue a DLQ entry, resetting its attempt count |
| `GET` | `/metrics` | Prometheus-format metrics (job counts by status/type, DLQ size, Redis queue depths) |

**Valid job types:** `fibonacci`, `sleep`, `email`, `webhook` — these are example handlers in `worker/handlers.js`; adding a new job type is just adding a new function to that map.

**Rate limiting:** 20 requests per 60-second window per IP, enforced via Redis. Responses include `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers; exceeding the limit returns `429` with a `Retry-After` header. The limiter fails open (allows requests through) if Redis is unreachable, so a Redis outage degrades gracefully rather than taking the API down.

---

## Running Tests

Tests run against the live Postgres/Redis containers (they're integration tests, not mocked unit tests):
```bash
docker compose exec app npm test
```
Covers: rate limiter behavior, circuit breaker state transitions (closed → open → half-open), job handler validation, and the job/DLQ REST endpoints.

---

## Design Notes

- **Why two datastores?** Postgres is the durable source of truth (every job's full state can be queried, filtered, and audited); Redis is a fast, disposable transport layer that simply signals "work is waiting." Losing Redis loses queue ordering, not job data.
- **Why `SKIP LOCKED`?** It lets multiple worker processes pull from the same backlog without blocking each other or double-processing a row — the foundation of safe horizontal scaling for this design.
- **Delivery semantics:** at-least-once, not exactly-once. A worker crash after a side effect but before a status update can cause a job to run again. Handlers that need this guarantee should be written idempotently.
- **Circuit breaker:** failures and open/closed state are tracked in Redis per job-type, so the breaker state is shared across every worker process, not just the one that observed the failure.

---

## Roadmap / Future Improvements

- [ ] Enforce `MAX_ATTEMPTS` in the reaper's stale-job recovery path so a job that repeatedly crashes its worker eventually lands in the DLQ instead of looping indefinitely
- [ ] API authentication (API key or JWT) before this would be exposed beyond a local/internal network
- [ ] `/health` and `/ready` endpoints for the API and Worker containers
- [ ] Idempotency keys on `POST /jobs` to make client-side retries safe
- [ ] Adaptive batch size in the delayed-job scheduler for bursty workloads

---

## Tech Stack

**Backend:** Node.js, Express.js
**Datastores:** PostgreSQL 16, Redis 7
**Infra:** Docker, Docker Compose
**Testing:** Node.js built-in test runner (`node:test`)
**Observability:** Prometheus-format metrics, JSON structured logging

