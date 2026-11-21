import { ApiError } from "@ren/client"
import { ErrorText } from "@ren/util/error-text"

export const errorStatus = ApiError.status

export const errorMessage = ErrorText.of
