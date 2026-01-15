export type ApiErrorPayload = {
  message: string
  code?: string
  details?: unknown
}

export type ApiSuccessResponse<T> = {
  success: true
  data: T
}

export type ApiErrorResponse = {
  success: false
  error: ApiErrorPayload
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

export const buildSuccessResponse = <T>(data: T): ApiSuccessResponse<T> => ({
  success: true,
  data
})

export const buildErrorResponse = (
  message: string,
  code?: string,
  details?: unknown
): ApiErrorResponse => ({
  success: false,
  error: {
    message,
    ...(code ? { code } : {}),
    ...(details !== undefined ? { details } : {})
  }
})
