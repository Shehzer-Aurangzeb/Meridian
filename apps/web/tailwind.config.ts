import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Theme-aware colors (use CSS variables)
        background: 'rgb(var(--background) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        primary: 'rgb(var(--primary) / <alpha-value>)',
        'primary-foreground': 'rgb(var(--primary-foreground) / <alpha-value>)',
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-tertiary': 'rgb(var(--text-tertiary) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        'border-hover': 'rgb(var(--border-hover) / <alpha-value>)',
        
        // Accent colors (theme-aware)
        gold: {
          DEFAULT: 'rgb(var(--gold) / <alpha-value>)',
          ink: 'rgb(var(--gold-ink) / <alpha-value>)',
          dark: 'rgb(var(--gold-dark) / <alpha-value>)',
          soft: 'rgb(var(--gold) / 0.18)',
        },
        green: {
          DEFAULT: 'rgb(var(--green) / <alpha-value>)',
          soft: 'rgb(var(--green) / 0.14)',
        },
        red: {
          DEFAULT: 'rgb(var(--red) / <alpha-value>)',
          soft: 'rgb(var(--red) / 0.14)',
        },
        amber: 'rgb(var(--amber) / <alpha-value>)',
        blue: 'rgb(var(--blue) / <alpha-value>)',
        
        // Legacy colors (kept for backwards compatibility during migration)
        'deep-green': {
          DEFAULT: '#113329',
          90: 'rgba(17, 51, 41, 0.92)',
          12: 'rgba(17, 51, 41, 0.12)',
          8: 'rgba(17, 51, 41, 0.08)',
        },
        sage: {
          DEFAULT: '#96AF93',
          soft: 'rgba(150, 175, 147, 0.22)',
        },
        rust: {
          DEFAULT: '#B0654A',
          soft: 'rgba(176, 101, 74, 0.14)',
        },
        beige: {
          DEFAULT: '#F4EFE7',
          2: '#FAF7F2',
        },
        muted: {
          DEFAULT: 'rgb(var(--text-secondary) / <alpha-value>)',
          2: 'rgb(var(--text-tertiary) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          strong: 'rgb(var(--border-hover) / <alpha-value>)',
        },
        // Sidebar specific (dark panel in light mode)
        'sidebar-bg': 'rgb(var(--sidebar-bg) / <alpha-value>)',
        'sidebar-text': 'rgb(var(--sidebar-text) / <alpha-value>)',
        'sidebar-text-muted': 'rgb(var(--sidebar-text-muted) / <alpha-value>)',
        'sidebar-gold': 'rgb(var(--sidebar-gold) / <alpha-value>)',
      },
      backgroundColor: {
        DEFAULT: '#F4EFE7',
      },
      fontFamily: {
        antonio: ['var(--font-antonio)', 'sans-serif'],
        inter: ['var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-lg': ['64px', { lineHeight: '0.98', letterSpacing: '0.03em' }],
        'display': ['56px', { lineHeight: '0.98', letterSpacing: '0.03em' }],
        'display-sm': ['40px', { lineHeight: '0.98', letterSpacing: '0.03em' }],
      },
      letterSpacing: {
        headline: '0.03em',
        eyebrow: '0.18em',
        wide: '0.14em',
      },
      spacing: {
        'sidebar': '260px',
        'content-max': '1280px',
      },
      borderRadius: {
        DEFAULT: '12px',
        sm: '8px',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'loading-bar': {
          '0%': { width: '0%', marginLeft: '0%' },
          '50%': { width: '60%', marginLeft: '20%' },
          '100%': { width: '0%', marginLeft: '100%' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'check-draw': {
          '0%': { strokeDashoffset: '24' },
          '100%': { strokeDashoffset: '0' },
        },
        'circle-draw': {
          '0%': { strokeDashoffset: '63' },
          '100%': { strokeDashoffset: '0' },
        },
        'slide-in-left': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'slide-out-left': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.35s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'loading-bar': 'loading-bar 1.5s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'check-draw': 'check-draw 0.3s ease-out 0.15s forwards',
        'circle-draw': 'circle-draw 0.3s ease-out forwards',
        'slide-in-left': 'slide-in-left 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)',
        'slide-out-left': 'slide-out-left 0.28s cubic-bezier(0.2, 0.8, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
