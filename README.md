# Paper Desk

A paper-trading app for US stocks, options and futures. No real money, no backend, no build step:
plain HTML, CSS and JavaScript that you can host for free on GitHub Pages.

## Features
- Multiple portfolios, each with its own cash, positions, P/L and value chart
- Add or withdraw paper money
- Buy, sell and short stocks (fractional shares allowed)
- Options: buy, sell, write (sell to open), close, with a payoff chart on every ticket
- Futures: ES, MES, NQ, MNQ, CL, GC with margin and dollars-per-point P/L
- Search any US stock or ETF, see its price history, and trade straight from the chart
- Admin tab: rename, set cash, reset or delete portfolios, delete positions, override prices
- Backup and restore as JSON, optional push/pull to a GitHub repo

## Project layout
```
index.html        page structure
css/style.css     styles (light and dark mode)
js/app.js         all app logic
data/             optional seed file: data/portfolio-data.json
```

## Host it on GitHub Pages
1. Create a new repository on GitHub and upload everything in this folder
   (or `git init`, `git add .`, `git commit`, `git push`).
2. Repository **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*,
   Branch = `main`, folder = `/ (root)`. Save.
3. After a minute your app is live at `https://<your-username>.github.io/<repo-name>/`.

To run locally instead, serve the folder (opening `index.html` directly also works, except for
the optional seed file):
```
python3 -m http.server 8000
```
then open http://localhost:8000.

## Live prices, search and history charts
GitHub Pages is a static site, so market data comes from a free API key you add yourself:
1. Create a free key at https://twelvedata.com.
2. In the app open **Admin → Data and sync**, paste the key, press Save, then **Refresh prices**.

The key is kept only in your browser's local storage and is never exported or pushed.
The free plan allows 8 quotes per minute, so refreshing a long watchlist pauses between batches.
Futures are not covered by the free plan: set their prices by hand in **Admin → Prices**.

Option prices are always calculated with the Black-Scholes model from the stock price and a
volatility you can edit per stock. They are not live option quotes.

## Where your data lives
- Normally in your browser's local storage (per browser and per device).
- **Backup**: Admin → Data and sync → Show JSON / Download file, and Import to restore.
- **GitHub sync**: enter your username, a repository, a file path and a fine-grained personal access
  token with **Contents: read and write** on that one repository. *Push* writes your data to that
  file, *Pull* loads it back. Use a **private** repository for the data: a public one would show your
  portfolio to everyone. The token is stored only in your browser and is excluded from the JSON.
- **Seed file**: if a browser has nothing saved, the app loads `data/portfolio-data.json` from the
  site when it exists.

## Notes and limits
- Orders fill instantly at the latest price shown. There are no commissions, partial fills or
  after-hours rules.
- Margin rules for short stock, written options and futures are simplified approximations.
- Futures are continuous front-month contracts with no expiry or rolling.
- Prices tagged **est.** are rough starter values until a refresh succeeds.
- Educational tool only. Nothing here is investment advice.

## Licence
MIT, see LICENSE.
