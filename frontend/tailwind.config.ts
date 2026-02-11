import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        hearst: {
          dark: '#0a0a0a',
          card: '#141414',
          surface: '#1a1a1a',
          border: '#262626',
          'border-light': '#333333',
          accent: '#4ade80',
          'accent-dim': '#22c55e',
          success: '#4ade80',
          warning: '#eab308',
          danger: '#ef4444',
          muted: '#737373',
          text: '#e5e5e5',
          'text-secondary': '#a3a3a3',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
export default config;
