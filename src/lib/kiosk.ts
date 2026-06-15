// EPIC18: exhibition kiosk build flag. Set (to "true") only on the kiosk Vercel
// project; the public web build leaves it unset and keeps the wallet-login flow.
// Client-readable (NEXT_PUBLIC) — kept out of backend/config.ts, which is server-
// only and holds the private key. Import this anywhere kiosk UX needs gating.
export const isKioskMode = process.env.NEXT_PUBLIC_KIOSK_MODE === 'true';
