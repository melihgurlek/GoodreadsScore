# Goodreads Puanı

A Chrome extension that shows Goodreads ratings on book pages at Amazon, Kitapyurdu and other bookstores.

## What it does

- Injects a Goodreads rating + review count next to the book title/byline
- Clicking the rating opens the Goodreads page for the book
- Clicking the review count jumps straight to the community reviews section
- The arrow next to the badge opens the rating distribution, review count and top genres
- Optionally shows a compact badge on each book in Amazon and Kitapyurdu search results
- The toolbar popup turns sites and search result badges on or off and clears the cache
- Caches results locally so repeat visits don't re-fetch

## Supported sites

- `amazon.com.tr` — detects book pages via ISBN elements in the product details
- `kitapyurdu.com` — detects book pages via `/kitap/` URL path + ISBN in attributes table
- `amazon.com`, `amazon.co.uk`, `amazon.de` — same detection as `amazon.com.tr`
- D&R, Idefix, BKM Kitap, Hepsiburada, Trendyol, Pandora, Babil, Kitapseç — read the ISBN, title and author from the page's schema.org (JSON-LD) data

## Installation

1. Clone or download this repo
2. Go to `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the folder

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension config, permissions, host matches |
| `background.js` | Fetches Goodreads rating via `fetch()` (runs in service worker) |
| `content.js` | Detects book pages and result cards, injects UI, handles caching |
| `settings.js` | Default settings, shared by the content script and the popup |
| `popup.html`, `popup.js`, `popup.css` | Toolbar popup: per-site switches, search results, cache |

## Notes

- Search result badges are off by default: result cards carry no ISBN, so each one costs Goodreads two or three title searches. Cards are looked up only once scrolled into view, two at a time, and a card with no match shows nothing
- Goodreads is queried by ISBN (preferred) or ASIN, then by title and author if that finds nothing (Goodreads' ISBN search stopped returning results in Sep 2026). A title match must share most of its words with the store's title and, when the store names one, the author; otherwise the badge says the book wasn't found rather than showing another book's rating
- Ratings are cached in `chrome.storage.local` — use "Önbelleği temizle" in the popup to force a re-fetch