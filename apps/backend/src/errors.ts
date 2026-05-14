/** Domain error with an HTTP-friendly status. Route handlers convert to JSON. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = (msg = "unauthenticated") => new AppError(401, msg);
export const forbidden = (msg = "forbidden") => new AppError(403, msg);
export const badRequest = (msg: string) => new AppError(400, msg);
export const notFound = (msg: string) => new AppError(404, msg);
export const conflict = (msg: string) => new AppError(409, msg);
