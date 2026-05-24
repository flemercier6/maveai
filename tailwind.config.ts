import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          foreground: "hsl(var(--surface-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "hsl(var(--primary-hover))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        bubble: {
          user: "hsl(var(--bubble-user))",
          "user-foreground": "hsl(var(--bubble-user-fg))",
          assistant: "hsl(var(--bubble-assistant))",
          "assistant-foreground": "hsl(var(--bubble-assistant-fg))",
        },
        tooltip: {
          DEFAULT: "hsl(var(--tooltip))",
          foreground: "hsl(var(--tooltip-foreground))",
        },
        "dropdown-hover": "hsl(var(--dropdown-hover))",
        "bg-primary-token": "hsl(var(--bg-primary))",
        "input-primary": {
          bg: "hsl(var(--input-primary-bg))",
          border: "hsl(var(--input-primary-border))",
        },
        "input-secondary": {
          bg: "hsl(var(--input-secondary-bg))",
          border: "hsl(var(--input-secondary-border))",
        },
        "btn-primary": {
          DEFAULT: "hsl(var(--button-primary-background))",
          foreground: "hsl(var(--button-primary-text))",
        },
        "btn-muted": {
          DEFAULT: "hsl(var(--button-muted-background))",
          foreground: "hsl(var(--button-muted-text))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
      fontSize: {
        // Design system: xxs=8px  xs=10px  sm=12px  bd=14px  lg=18px
        xxs:  ['8px',  { lineHeight: '1.4' }],
        xs:   ['10px', { lineHeight: '1.4' }],
        sm:   ['12px', { lineHeight: '1.45' }],
        base: ['14px', { lineHeight: '1.5' }],
        lg:   ['18px', { lineHeight: '1.45' }],
        xl:   ['24px', { lineHeight: '1.3' }],
      },
      boxShadow: {
        soft: 'var(--shadow-sm)',
        elevated: 'var(--shadow-md)',
      },
      borderRadius: {
        // Design system: xxs=4px  sm=10px  bd=14px  lg=24px  xl=50px
        sm:  '4px',
        md:  '10px',
        lg:  'var(--radius)',  /* 14px (bd) */
        xl:  '24px',
        '2xl': '50px',
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "title-shimmer": {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "title-shimmer": "title-shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
