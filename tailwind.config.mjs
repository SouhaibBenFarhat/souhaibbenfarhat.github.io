/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        ink: 'var(--text)',
        muted: 'var(--muted)',
        line: 'var(--line)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
      },
      fontFamily: {
        // "… Variable" is the family name the self-hosted @fontsource-variable builds register
        // (see Base.astro) — not a label, so it can't be shortened.
        sans: ['Inter Variable', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Fraunces Variable', 'ui-serif', 'Georgia', 'serif'],
      },
      maxWidth: {
        content: '68rem',
        prose: '46rem',
      },
      letterSpacing: {
        label: '0.18em',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [],
};
