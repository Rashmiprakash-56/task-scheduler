CREATE TABLE IF NOT EXISTS jobs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type        VARCHAR(50) NOT NULL,
    payload     JSONB NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'queued',
    priority    INT NOT NULL DEFAULT 1,
    run_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    attempts    INT NOT NULL DEFAULT 0,
    result      JSONB,
    error       TEXT,
    locked_by   VARCHAR(100),
    locked_at   TIMESTAMP,
    cancelled   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
CREATE INDEX IF NOT EXISTS idx_jobs_run_at ON jobs(run_at);
CREATE INDEX IF NOT EXISTS idx_jobs_locked_at ON jobs(locked_at);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id      UUID NOT NULL,
    type        VARCHAR(50) NOT NULL,
    payload     JSONB NOT NULL,
    error       TEXT,
    attempts    INT NOT NULL,
    failed_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
