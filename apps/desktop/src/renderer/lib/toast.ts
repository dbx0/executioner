import { toast } from 'sonner'

/** App-wide toast: `notify(msg)` for neutral messages, `.success` and `.error` for outcomes. */
export const notify = Object.assign((message: string): void => void toast(message), {
  success: (message: string): void => void toast.success(message),
  error: (message: string): void => void toast.error(message),
})
