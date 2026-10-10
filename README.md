# Haven House Hotel Desk

A browser-based hotel desk starter app built for two hotel roles only: **Admin** and **Cashier**. The repository originally contained only a README, so this implementation creates the front-end and a small shared-data API from scratch.

## Run locally

```bash
npm install
npm run dev
```

Vite serves the app on port `5173` and proxies `/api` to the hotel API on port `3001`. For a production-style run, build the front end and start the API/static server:

```bash
npm run build
npm start
```

The server stores hotel data in `.hotel-data.json` at the repository root. That file is intentionally git-ignored. Remove it to reset to the sample hotel data.

## Included flows

- Role selection for **Admin** or **Cashier** only; role-specific navigation and access.
- Cashier room cards: green means available, orange means occupied. Selecting an available room opens check-in; selecting an occupied room opens its current bill.
- Check-in captures guest details, an agreed price per night, and a searchable currency selector. ETB is the default and the common currencies are listed first.
- Occupied-room drawer shows the stay-day counter and running room total, then **Outdoor** (the shared QR menu) and **Other service**. Food and service lines remain ETB; a foreign-currency room charge stays separate.
- Table and room QR links are unique. Table/room menu orders sync through the shared API and appear below the room cards on the cashier desk.
- Admin pages for room pricing and QR codes, tables, menu categories/items and photo uploads, receipt-template fields, staff roles, archived receipts, and reports.
- Receipt archive and currency-separated reports. Receipt print layout targets 80 mm thermal paper and deliberately has no receipt QR code, VAT line, or service-charge/tax line.

## Important deployment note

This is a functional starter build, not a production-secured property-management service. The sign-in screen demonstrates the two role views but does not authenticate passwords or protect the API; add real authentication, authorization and operational backups before exposing it publicly. Browser printing opens the system print dialog, where the cashier must choose the hotel’s configured 80 mm order printer. The room tiles, dark cashier palette, green free-room outlines, and archived-ticket cards are styled from the screenshots provided. The sample paper receipt itself includes fiscal QR/tax markings, which remain intentionally omitted because the requested hotel receipt must be non-fiscal and must not print a QR code or tax/service-charge lines.
