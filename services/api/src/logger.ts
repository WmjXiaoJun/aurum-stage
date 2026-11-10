import { config } from './config.js';

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let currentTrace: string | undefined;

export function setTraceId(id: string | undefined): void {
  currentTrace = id;
}

export function newTraceId(): string {
  return 'tr_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

const REDACT: Array<[RegExp, string]> = [
  [/Bearer\s+[A-Za-z0-9._~+\/-]+/g, 'Bearer ***'],
  [/"?(api[_-]?key|secret|token|password)"?\s*[:=]\s*"[^"]*"/gi, '$1: "***"'],
  [/sk-[A-Za-z0-9]{8,}/g, 'sk-***']
];

export function sanitize(msg: string): string {
  let out = msg;
  for (const [re, rep] of REDACT) out = out.replace(re, rep);
  return out;
}

interface LogFields {
  service?: string;
  task_id?: number | string | null;
  shot_id?: number | string | null;
  project_id?: number | string | null;
  latency_ms?: number;
  [k: string]: unknown;
}

export function log(level: 'debug' | 'info' | 'warn' | 'error', msg: string, fields: LogFields = {}): void {
  if (LEVELS[level] < LEVELS[config.logLevel]) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    level,
    service: fields.service ?? 'api',
    trace_id: fields.trace_id ?? currentTrace,
    ...fields,
    msg: sanitize(msg)
  };
  for (const k of Object.keys(record)) if (record[k] === undefined) delete record[k];
  const line = JSON.stringify(record);
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export const logger = {
  debug: (m: string, f?: LogFields) => log('debug', m, f),
  info: (m: string, f?: LogFields) => log('info', m, f),
  warn: (m: string, f?: LogFields) => log('warn', m, f),
  error: (m: string, f?: LogFields) => log('error', m, f)
};
