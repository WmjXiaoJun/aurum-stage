import { errorMeta, type ErrorCode, ERROR_CODES } from '@aurum/core';

export class ApiError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  readonly uiHint: string;

  constructor(code: ErrorCode | string, message?: string, details?: Record<string, unknown>, httpStatus?: number) {
    const meta = errorMeta(String(code));
    super(message ?? meta.name);
    this.code = meta.code;
    this.httpStatus = httpStatus ?? meta.httpStatus;
    this.details = details;
    this.uiHint = meta.uiHint;
  }

  toJSON(): Record<string, unknown> {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        ui_hint: this.uiHint,
        retry: errorMeta(this.code).retry,
        details: this.details ?? null
      }
    };
  }
}

export function badRequest(message: string, details?: Record<string, unknown>): ApiError {
  return new ApiError('PARAM_INVALID', message, details);
}

export function notFound(message = '资源不存在'): ApiError {
  return new ApiError('NOT_FOUND', message);
}

export function segmentExceed(details: { segment_id: number; title: string; duration_sec: number; exceed_sec: number; split_hint: string }): ApiError {
  return new ApiError(
    'SEGMENT_DURATION_EXCEED',
    '本段已达 ' + details.duration_sec + ' 秒，超出上限 ' + details.exceed_sec + ' 秒，请删减镜头或拆分段落',
    details
  );
}

export { ERROR_CODES };
