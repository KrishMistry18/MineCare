/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        industrial: {
          950: '#070a0f',
          900: '#0d131d',
          850: '#111927',
          800: '#1a2333',
          700: '#26344b',
          600: '#384964',
          500: '#526685',
          400: '#8395b0',
          300: '#b4c2d6',
          200: '#e1e8f2',
        },
        mine: {
          safe: '#10b981',      // Emerald Green
          warning: '#f59e0b',   // Safety Amber
          danger: '#ef4444',    // Hazard Crimson
          info: '#38bdf8',      // Sensor Cyan/Blue
          neutral: '#94a3b8',   // Muted Slate
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'flash-danger': 'dangerFlash 0.8s ease-in-out infinite alternate',
      },
      keyframes: {
        dangerFlash: {
          '0%': { borderColor: 'rgba(239, 68, 68, 0.3)', backgroundColor: 'rgba(239, 68, 68, 0.05)' },
          '100%': { borderColor: 'rgba(239, 68, 68, 1)', backgroundColor: 'rgba(239, 68, 68, 0.25)' },
        }
      }
    },
  },
  plugins: [],
}
