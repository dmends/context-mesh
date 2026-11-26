export const MULTI_CLI_VERSION = process.env.MULTI_CLI_VERSION ?? '1.5.41';
export const STATE_SCHEMA_VERSION = 1;
export const MIN_NODE_VERSION = Number(process.env.MIN_NODE_VERSION ?? '22');
export const GITHUB_MCP_READONLY_URL = process.env.GITHUB_MCP_READONLY_URL ?? 'https://api.githubcopilot.com/mcp/readonly';
export const RUN_LOCK_TIMEOUT_MS = Number(process.env.RUN_LOCK_TIMEOUT_MS ?? '30000');
export const RUN_LOCK_STALE_MS = Number(process.env.RUN_LOCK_STALE_MS ?? '300000');
