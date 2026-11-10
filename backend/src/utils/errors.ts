export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message);
    this.name = 'BadRequestError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
    this.name = 'ConflictError';
  }
}

// Thrown by the rate limiters in middlewares/rateLimit.ts. Going through
// AppError keeps the throttled response in the same { success, data, message }
// envelope as every other error, instead of express-rate-limit's own plain-text
// body, which the frontend's apiFetch would fail to parse as JSON.
export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super(429, message);
    this.name = 'TooManyRequestsError';
  }
}
