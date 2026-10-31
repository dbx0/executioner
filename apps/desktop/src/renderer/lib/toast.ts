import { createElement } from 'react'
import { toast } from 'sonner'
import { AttentionToast } from '../components/AttentionToast.js'

/**
 * The toaster for "an agent needs you" toasts. It sits at the top of the window, over the
 * titlebar and tab strip, where no native browser view can ever be drawn, so its toasts stay
 * visible without hiding the browser the operator is asked to work in.
 */
export const ATTENTION_TOASTER = 'attention'

/** App-wide toast: `notify(msg)` for neutral messages, `.success` and `.error` for outcomes. */
export const notify = Object.assign((message: string): void => void toast(message), {
  success: (message: string): void => void toast.success(message),
  error: (message: string): void => void toast.error(message),
  /** A notch under the titlebar that asks for the operator: `who` is waiting, `text` says on what. */
  attention: (opts: { who: string; text: string; description?: string; action: { label: string; onClick: () => void } }): void =>
    void toast.custom(
      (id) =>
        createElement(AttentionToast, {
          who: opts.who,
          text: opts.text,
          description: opts.description,
          actionLabel: opts.action.label,
          onAction: opts.action.onClick,
          onDismiss: () => toast.dismiss(id),
        }),
      { toasterId: ATTENTION_TOASTER, duration: 10_000 },
    ),
})
