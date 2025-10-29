/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./globals.css",
  ],
  theme: {
    extend: {
      boxShadow: {
        card: "0 20px 60px -10px rgba(0,0,0,0.8)",
      },
      colors: {
        surface: "rgba(255,255,255,0.03)",
        surfaceBorder: "rgba(255,255,255,0.08)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
    },
  },
  plugins: [],
};
