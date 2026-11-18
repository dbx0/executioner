/**
 * A theme token as a Tailwind color. Tailwind cannot apply an opacity modifier
 * (`bg-primary/90`, `ring-ring/50`) to a bare `var()`, and silently emits no
 * rule at all, so every token goes through color-mix with the alpha slot.
 */
const token = (name) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: token('--background'),
        foreground: token('--foreground'),
        card: { DEFAULT: token('--card'), foreground: token('--card-foreground') },
        popover: { DEFAULT: token('--popover'), foreground: token('--popover-foreground') },
        primary: { DEFAULT: token('--primary'), foreground: token('--primary-foreground') },
        secondary: { DEFAULT: token('--secondary'), foreground: token('--secondary-foreground') },
        muted: { DEFAULT: token('--muted'), foreground: token('--muted-foreground') },
        accent: { DEFAULT: token('--accent'), foreground: token('--accent-foreground') },
        destructive: { DEFAULT: token('--destructive'), foreground: token('--destructive-foreground') },
        surface: {
          1: token('--surface-1'),
          2: token('--surface-2'),
          3: token('--surface-3'),
        },
        border: {
          DEFAULT: token('--border'),
          subtle: token('--border-subtle'),
          strong: token('--border-strong'),
        },
        glass: {
          DEFAULT: token('--glass'),
          strong: token('--glass-strong'),
          active: token('--glass-active'),
          border: token('--glass-border'),
          highlight: token('--glass-highlight'),
        },
        'tertiary-foreground': token('--tertiary-foreground'),
        'disabled-foreground': token('--disabled-foreground'),
        input: token('--input'),
        ring: token('--ring'),
        sidebar: {
          DEFAULT: token('--sidebar'),
          foreground: token('--sidebar-foreground'),
          accent: token('--sidebar-accent'),
          'accent-foreground': token('--sidebar-accent-foreground'),
          border: token('--sidebar-border'),
        },
        ai: token('--ai'),
        attention: token('--attention'),
        activity: token('--activity'),
        'status-success': token('--status-success'),
        'status-running': token('--status-running'),
        'status-error': token('--status-error'),
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
        panel: 'var(--radius-panel)',
        control: 'var(--radius-control)',
      },
      spacing: {
        panel: 'var(--panel-gap)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        floating: 'var(--shadow-floating)',
        glass: 'inset 0 1px 0 var(--glass-highlight)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'zoom-in': { from: { opacity: '0', transform: 'scale(0.98)' }, to: { opacity: '1', transform: 'scale(1)' } },
        spin: { to: { transform: 'rotate(360deg)' } },
        enter: {
          from: { opacity: '0', transform: 'translateY(14px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'enter-x': {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'enter-down': { from: { transform: 'translateY(-100%)' }, to: { transform: 'translateY(0)' } },
        'flash-amber': { from: { backgroundColor: 'rgba(251,191,36,.14)' }, to: { backgroundColor: 'transparent' } },
        'flash-red': { from: { backgroundColor: 'rgba(248,113,113,.16)' }, to: { backgroundColor: 'transparent' } },
        pop: {
          from: { opacity: '0', transform: 'scale(.5)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'grow-x': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
        'grow-y': { from: { transform: 'scaleY(0)' }, to: { transform: 'scaleY(1)' } },
        'node-in': {
          from: { opacity: '0', transform: 'scale(.9)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'zoom-in': 'zoom-in 0.14s ease-out',
        enter: 'enter 500ms cubic-bezier(.215,.61,.355,1) both',
        'enter-x': 'enter-x 300ms cubic-bezier(.215,.61,.355,1) both',
        'enter-down': 'enter-down 550ms cubic-bezier(.215,.61,.355,1) both',
        'flash-amber': 'flash-amber 900ms',
        'enter-flash-amber': 'enter-x 300ms cubic-bezier(.215,.61,.355,1) both, flash-amber 900ms',
        'flash-red': 'flash-red 1600ms ease-out',
        'enter-down-flash-red': 'enter-down 550ms cubic-bezier(.215,.61,.355,1) both, flash-red 1600ms ease-out',
        pop: 'pop 250ms cubic-bezier(.34,1.56,.64,1)',
        'grow-x': 'grow-x 900ms cubic-bezier(.215,.61,.355,1) both',
        'grow-y': 'grow-y 600ms cubic-bezier(.215,.61,.355,1) both',
        'node-in': 'node-in 400ms cubic-bezier(.34,1.56,.64,1) both',
      },
    },
  },
  plugins: [],
}
