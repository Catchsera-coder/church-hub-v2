/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // Sanctuary palette (brandable per tenant later).
        primary: {
          50: '#eef0f9', 100: '#d9ddf1', 200: '#b6bde4', 300: '#8f9ad3',
          400: '#6c78c1', 500: '#4f5bad', 600: '#3b3f8c', 700: '#33377a',
          800: '#2a2d63', 900: '#232650',
        },
      },
      fontFamily: {
        // Clean, modern sans throughout (headings use the same family, heavier).
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', 'Inter', 'ui-sans-serif', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
