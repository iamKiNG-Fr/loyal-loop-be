export type ApiResponse<T> = {
  success: boolean;
  message: string;
  data: T | null;
  meta?: PageMeta;
  requestId?: string;
};

export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ApiErrorResponse = ApiResponse<null> & {
  code: string;
  errors?: string[];
};

export function ok<T>(data: T, message = "Request completed"): ApiResponse<T> {
  return { success: true, message, data };
}

export function paginated<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
  message = "Request completed",
): ApiResponse<T[]> {
  return {
    success: true,
    message,
    data: items,
    meta: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}
