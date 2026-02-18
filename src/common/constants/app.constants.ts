export const BCRYPT_ROUNDS = 10;

export const TOKEN_EXPIRY = {
  ACCESS: '15m',
  REFRESH: '7d',
} as const;

export const DEFAULT_PROFIT_MARGIN = 30;

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 50,
  MAX_LIMIT: 200,
} as const;

export const PORTS = {
  BACKEND: 3002,
  FRONTEND: 3100,
} as const;

export const FRONTEND_URL_DEFAULT = 'http://localhost:3100';

export const CLEANUP_OLDER_THAN_DAYS = 30;
