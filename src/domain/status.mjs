export const StepStatus = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  ACCUMULATING: 'accumulating',
  BLOCKED: 'blocked',
  READY: 'ready',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

export const CheckStatus = Object.freeze({
  OK: 'ok',
  ERROR: 'error',
  WARNING: 'warning',
  SKIP: 'skip',
});

export const SyncStatus = Object.freeze({
  CLONED: 'cloned',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  PLANNED: 'planned',
  SKIPPED: 'skipped',
  AHEAD: 'ahead',
  DIVERGED: 'diverged',
  ERROR: 'error',
  FAILED: 'failed',
});

export const InstallStatus = Object.freeze({
  PLANNED: 'planned',
  INSTALLED: 'installed',
  CONFIGURED: 'configured',
  UNCHANGED: 'unchanged',
  CONFLICT: 'conflict',
  NOT_NEEDED: 'not-needed',
});
