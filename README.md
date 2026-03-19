# Goodreads on Amazon

A Chrome extension that shows Goodreads ratings on Amazon and Kitapyurdu book pages.

## What it does

- Injects a Goodreads rating + review count next to the book title/byline
- Clicking the rating opens the Goodreads page for the book
- Clicking the review count jumps straight to the community reviews section
- Caches results locally so repeat visits don't re-fetch

## Supported sites

- `amazon.com.tr` — detects book pages via ISBN elements in the product details
- `kitapyurdu.com` — detects book pages via `/kitap/` URL path + ISBN in attributes table

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
| `content.js` | Detects book pages, injects UI, handles caching |

## Notes

- Only activates on book pages, not search results or category pages
- Goodreads is queried by ISBN (preferred) or ASIN as fallback
- Ratings are cached in `chrome.storage.local` — clear extension storage to force a re-fetch