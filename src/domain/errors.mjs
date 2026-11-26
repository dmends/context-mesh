export class WorkflowError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'WorkflowError';
    this.code = code;
  }
}

export class InstallError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'InstallError';
    this.code = code;
  }
}

export class SyncError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'SyncError';
    this.code = code;
  }
}

export class ConfigError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ConfigError';
    this.code = code;
  }
}
