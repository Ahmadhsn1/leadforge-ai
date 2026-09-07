import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * LeadForge design system.
 *
 * Every colour is a CSS variable defined in app/globals.css so light and dark
 * are one source of truth. Components must never reference a raw hex value.
 * Density is tuned for data-dense sales tooling: a 4px rhythm, compact type
 * scale and hairline borders rather than heavy cards and shadows.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', xl: '2rem' },
      screens: { '2xl': '1600px' },
    },
    extend: {
      colors: {
        // Base surfaces — layered, not flat. bg < surface < raised < overlay.
        background: 'hsl(var(--background))',
        surface: 'hsl(var(--surface))',
        raised: 'hsl(var(--raised))',
        overlay: 'hsl(var(--overlay))',
        foreground: 'hsl(var(--foreground))',

        border: 'hsl(var(--border))',
        'border-strong': 'hsl(var(--border-strong))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',

        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          muted: 'hsl(var(--primary-muted))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
          muted: 'hsl(var(--accent-muted))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        subtle: {
          DEFAULT: 'hsl(var(--subtle))',
          foreground: 'hsl(var(--subtle-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
          muted: 'hsl(var(--destructive-muted))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
          muted: 'hsl(var(--success-muted))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
          muted: 'hsl(var(--warning-muted))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
          muted: 'hsl(var(--info-muted))',
        },
        // Lead temperature — used by score chips and the funnel.
        hot: 'hsl(var(--hot))',
        warm: 'hsl(var(--warm))',
        moderate: 'hsl(var(--moderate))',
        cold: 'hsl(var(--cold))',
      },
      borderRadius: {
        xs: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 2px)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) + 2px)',
        xl: 'calc(var(--radius) + 6px)',
        '2xl': 'calc(var(--radius) + 12px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        // Compact scale: dense tables need 11-13px to stay readable.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
        xs: ['0.75rem', { lineHeight: '1.125rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.375rem' }],
        md: ['0.9375rem', { lineHeight: '1.5rem' }],
        lg: ['1.0625rem', { lineHeight: '1.625rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.018em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.022em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.026em' }],
        '5xl': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
      },
      spacing: {
        // 4px rhythm with named sidebar/topbar sizes used by the app shell.
        sidebar: '15rem',
        'sidebar-collapsed': '3.5rem',
        topbar: '3.25rem',
      },
      boxShadow: {
        // Restrained: elevation comes from surface colour + border, not blur.
        subtle: '0 1px 2px 0 hsl(var(--shadow-color) / 0.08)',
        raised:
          '0 2px 8px -2px hsl(var(--shadow-color) / 0.14), 0 1px 2px hsl(var(--shadow-color) / 0.08)',
        overlay:
          '0 16px 48px -12px hsl(var(--shadow-color) / 0.28), 0 4px 12px -4px hsl(var(--shadow-color) / 0.16)',
        glow: '0 0 0 1px hsl(var(--primary) / 0.35), 0 0 24px -6px hsl(var(--primary) / 0.45)',
        'inset-top': 'inset 0 1px 0 0 hsl(var(--border) / 0.6)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0.5)' },
          '70%': { boxShadow: '0 0 0 6px hsl(var(--primary) / 0)' },
          '100%': { boxShadow: '0 0 0 0 hsl(var(--primary) / 0)' },
        },
        'stream-dot': {
          '0%, 60%, 100%': { opacity: '0.25', transform: 'translateY(0)' },
          '30%': { opacity: '1', transform: 'translateY(-2px)' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(300%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'fade-up': 'fade-up 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        'scale-in': 'scale-in 140ms cubic-bezier(0.22, 1, 0.36, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'stream-dot': 'stream-dot 1.2s ease-in-out infinite',
        'progress-indeterminate': 'progress-indeterminate 1.4s ease-in-out infinite',
        'accordion-down': 'accordion-down 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        'accordion-up': 'accordion-up 180ms cubic-bezier(0.55, 0, 1, 0.45)',
      },
      transitionTimingFunction: {
        // Decelerate on arrival; the app's single shared easing.
        out: 'cubic-bezier(0.22, 1, 0.36, 1)',
        in: 'cubic-bezier(0.55, 0, 1, 0.45)',
      },
      zIndex: {
        base: '0',
        sticky: '10',
        dropdown: '20',
        overlay: '40',
        modal: '50',
        toast: '60',
        palette: '70',
      },
    },
  },
  plugins: [animate],
};

export default config;
