export interface ApiResponse<T = unknown> {
  success: boolean;
  data: T | null;
  message: string | null;
}

export function ok<T>(data: T, message?: string): ApiResponse<T> {
  return { success: true, data, message: message ?? null };
}

export function fail(message: string): ApiResponse<null> {
  return { success: false, data: null, message };
}
