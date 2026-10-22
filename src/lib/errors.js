'use strict';

/**
 * Application error carrying an HTTP status. Rendered as an RFC 7807
 * "problem details" response by the HTTP layer.
 */
class AppError extends Error {
  constructor(status, title, detail, extra = {}) {
    super(detail || title);
    this.name = 'AppError';
    this.status = status;
    this.title = title;
    this.detail = detail || title;
    this.extra = extra;
  }
}

const badRequest = (detail, extra) => new AppError(400, 'Bad Request', detail, extra);
const unauthorized = (detail = 'Authentication required') => new AppError(401, 'Unauthorized', detail);
const forbidden = (detail = 'You do not have permission to perform this action') =>
  new AppError(403, 'Forbidden', detail);
const notFound = (detail = 'Resource not found') => new AppError(404, 'Not Found', detail);
const conflict = (detail) => new AppError(409, 'Conflict', detail);
const payloadTooLarge = (detail = 'Request body is too large') => new AppError(413, 'Payload Too Large', detail);
const unsupportedMediaType = (detail = 'Content-Type must be application/json') =>
  new AppError(415, 'Unsupported Media Type', detail);
const tooManyRequests = (detail, retryAfterSeconds) =>
  new AppError(429, 'Too Many Requests', detail, { retryAfterSeconds });

module.exports = {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  payloadTooLarge,
  unsupportedMediaType,
  tooManyRequests
};
