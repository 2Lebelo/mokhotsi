type Level = 'debug' | 'info' | 'warn' | 'error';
type Context = Record<string, unknown>;

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = __DEV__ ? 'debug' : 'info';

function emit(level: Level, scope: string, message: string, context?: Context): void {
  if (ORDER[level] < ORDER[minLevel]) return;
  const line = { ts: new Date().toISOString(), level, scope, message, ...context };
  const sink = level === 'debug' ? console.log : console[level];
  sink(JSON.stringify(line));
}

export interface Logger {
  debug(message: string, context?: Context): void;
  info(message: string, context?: Context): void;
  warn(message: string, context?: Context): void;
  error(message: string, context?: Context): void;
}

/** Structured, scoped logger: `const log = createLogger('sync'); log.info('pushed', { n })`. */
export function createLogger(scope: string): Logger {
  return {
    debug: (m, c) => emit('debug', scope, m, c),
    info: (m, c) => emit('info', scope, m, c),
    warn: (m, c) => emit('warn', scope, m, c),
    error: (m, c) => emit('error', scope, m, c),
  };
}
