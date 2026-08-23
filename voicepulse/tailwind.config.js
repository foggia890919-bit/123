/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#0B0F17',
        surface: '#151B27',
        card: '#1C2434',
        border: '#2A3447',
        primary: '#6C5CE7',
        accent: '#00D2B4',
        danger: '#FF5C7A',
        warning: '#F5A623',
        muted: '#8B94A7',
      },
    },
  },
  plugins: [],
};
