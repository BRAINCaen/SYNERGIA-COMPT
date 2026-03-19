import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Dark theme BOEHME
        dark: {
          bg: '#0D1117',
          card: '#161B22',
          input: '#21262D',
          border: '#30363D',
          hover: '#292E36',
        },
        accent: {
          green: '#00C896',
          orange: '#FF8C42',
          red: '#FF3B30',
          blue: '#58A6FF',
        },
        primary: {
          50: '#0D1117',
          100: '#161B22',
          200: '#21262D',
          300: '#30363D',
          400: '#58A6FF',
          500: '#00C896',
          600: '#00C896',
          700: '#00B384',
          800: '#009E74',
          900: '#008A64',
          950: '#006F50',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'Menlo', 'Monaco', 'monospace'],
        sans: ['IBM Plex Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
