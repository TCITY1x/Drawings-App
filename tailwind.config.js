/**
 * FieldMark teal. The drawings screens were written against Tailwind's
 * `indigo`, so that name points at this scale too; new work can say `brand-*`.
 * Teal keeps clear of the three markup inks (red, blue, yellow).
 */
const brand = {
  50: '#effcf9',
  100: '#c9f6ec',
  200: '#94ecdb',
  300: '#57dbc5',
  400: '#27c1ab',
  500: '#0ea592',
  600: '#088577',
  700: '#0b6a61',
  800: '#0e554f',
  900: '#114642',
  950: '#032a28',
}

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'media',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: { brand, indigo: brand },
      fontFamily: { sans: ['var(--font-inter)', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
}
