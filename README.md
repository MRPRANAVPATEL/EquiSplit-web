# EquiSplit-web

**Thoughtfully built by Pranav Patel to solve everyday problems.**

EquiSplit is a mobile-first web app built with React, TypeScript, and Vite for splitting bills on trips, at dinners, and on group outings. Set how many people each payer covers, log expenses in rupees, and share who owes whom. Add it to your iPhone Home Screen and use it offline after the first load. Your data stays on your device.

> Built for personal use and web development practice. Install it at your own discretion.

## Add it to an iPhone Home Screen

1. Open your deployed EquiSplit link in **Safari**.
2. Open the **Share** menu and choose **Add to Home Screen**.
3. If Safari shows **Open as Web App**, turn it on. Tap **Add**.
4. Open the EquiSplit icon and give the app one online visit to prepare its offline files.

On browsers that offer an install prompt, use **Install** in EquiSplit or install it from the browser menu.

## Split a group bill

1. Create a group with the total number of people sharing the expenses.
2. Add each payer and the number of people they cover, including themselves.
3. Record the description, amount, payer, and date for each expense.
4. Open **Settle up** to see each payer's share and the transfers. Use **Share settlement** to send or copy the summary.

EquiSplit uses the same whole-paise rounding and settlement rules as the [Android app](https://github.com/MRPRANAVPATEL/EquiSplit). IndexedDB stores groups and expenses locally in the browser or installed web app. The service worker caches the app for offline use after the first successful load. Each device keeps its own records.

## Develop locally

Use Node.js 22.12 or later. The app uses React, TypeScript, Vite, flexbox CSS, and Workbox through Vite PWA.

```sh
npm ci
npm run dev
```

Build and preview the production app to check offline behavior.

```sh
npm test
npm run build
npm run preview
```

## Deploy to Vercel

Import the GitHub repository in Vercel. The Vite build command is `npm run build` and the output directory is `dist`. These settings are included in `vercel.json`. Use the deployed HTTPS URL to install and test offline use on your phone.

---

*Thoughtfully built by Pranav Patel to make splitting bills with friends and family easier.*
