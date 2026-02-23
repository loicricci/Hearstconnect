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
          accent: '#96EA7A',
          'accent-dim': '#6BD85A',
          success: '#96EA7A',
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
