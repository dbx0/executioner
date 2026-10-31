let audioCtx: AudioContext | null = null

/** A short two-tone chime, synthesized so no audio asset is needed. */
export function playNotificationChime(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (Ctor === undefined) return
    audioCtx ??= new Ctor()
    const ctx = audioCtx
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const { f, t } of [
      { f: 880, t: 0 },
      { f: 1174.66, t: 0.11 },
    ]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = f
      gain.gain.setValueAtTime(0.0001, now + t)
      gain.gain.exponentialRampToValueAtTime(0.14, now + t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.34)
      osc.connect(gain).connect(ctx.destination)
      osc.start(now + t)
      osc.stop(now + t + 0.4)
    }
  } catch {
    /* audio unavailable */
  }
}

/** Show an OS notification (best-effort; requests permission once). `onClick` runs when it is clicked. */
export function notifyUser(title: string, body?: string, onClick?: () => void): void {
  try {
    if (typeof Notification === 'undefined') return
    const show = (): void => {
      const n = body !== undefined && body !== '' ? new Notification(title, { body }) : new Notification(title)
      if (onClick !== undefined) {
        n.onclick = () => {
          window.focus()
          onClick()
        }
      }
    }
    if (Notification.permission === 'granted') show()
    else if (Notification.permission !== 'denied')
      void Notification.requestPermission().then((p) => {
        if (p === 'granted') show()
      })
  } catch {
    /* notifications unavailable */
  }
}
