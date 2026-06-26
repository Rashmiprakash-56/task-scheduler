# Task Scheduler

> A production-grade Dockerized task scheduler built with Express.js, Redis, and PostgreSQL supporting priority queues, scheduled jobs, dead-letter queues (DLQ), and horizontal scaling.

## Project Summary

This project implements a distributed task queue designed for reliability and scalability. 

- **API Service**: Exposes REST endpoints to create, cancel, and query jobs, as well as fetch Prometheus metrics. Includes built-in rate limiting (Redis sliding window).
- **PostgreSQL**: Source of truth for all job data, including states, attempts, errors, and scheduled times.
- **Redis**: Used as a fast, in-memory message broker (using `LPUSH` and `BRPOP`), a rate limiter store, and a delayed job store (using Sorted Sets).
- **Worker**: A separate Node.js process that pops jobs from priority queues. It uses `SELECT ... FOR UPDATE SKIP LOCKED` to ensure that multiple worker instances can safely process jobs concurrently without race conditions.

### New Features Addressed
- **Job Priority Queues**: `high`, `normal`, and `low` priority jobs.
- **Scheduled/Delayed Jobs**: Jobs can be scheduled to run at a specific timestamp.
- **Horizontal Worker Scaling**: Workers safely lock jobs in Postgres to prevent concurrent processing of the same job.
- **Dead Letter Queue (DLQ)**: Jobs failing more than 3 times are moved to a DLQ for inspection and manual retry.
- **Stale Job Recovery**: A periodic reaper process recovers jobs stuck in `running` if a worker crashes mid-execution.
- **Job Cancellation**: Easily cancel queued or scheduled jobs.
- **Rate Limiting**: IP-based rate limiting on the API.
- **Structured Logging & Metrics**: JSON structured logging and a `/metrics` Prometheus endpoint.

## Architecture

```text
                  Client
                     |
            Express API + Rate Limiter
                     |
        +------------+-------------+
        |                          |
        v                          v
  PostgreSQL                 Redis
    Jobs & DLQ             Queues & ZSET (Delayed)
                                   |
                                   v
                             Worker 1 & Worker 2
                               (BRPOP + Postgres SKIP LOCKED)
                                   |
                                   v
                          PostgreSQL Updates
```

## Local Run

```bash
docker compose up --build
```
This will start PostgreSQL, Redis, 1 API instance, and 2 Worker instances.

## API Examples

### Create a High-Priority Job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "fibonacci", "payload": {"n": 10}, "priority": "high"}'
```

### Create a Scheduled/Delayed Job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{"type": "sleep", "payload": {"ms": 3000}, "run_at": "2026-12-31T23:59:59Z"}'
```

### List Jobs (Pagination & Filtering)

```bash
curl "http://localhost:3000/jobs?status=succeeded&priority=high&page=1&limit=5"
```

### Get Job Status

```bash
curl http://localhost:3000/jobs/<job-id>
```

### Cancel a Job

```bash
curl -X DELETE http://localhost:3000/jobs/<job-id>
```

### Prometheus Metrics

```bash
curl http://localhost:3000/metrics
```

## Testing

Tests are written using Node.js' built-in test runner (`node:test`).
To run them inside the running container:
```bash
docker compose exec app npm test
```
