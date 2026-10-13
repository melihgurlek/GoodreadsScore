// --- SITE ROUTER ---
const hostname = window.location.hostname;
let identifier = null;
let targetElement = null;
let insertPosition = "afterend";
let structuredBook = null;

if (hostname.includes("amazon") && isAmazonBookPage()) {
    identifier = getAmazonIdentifier();
    targetElement = document.getElementById("bylineInfo") || document.getElementById("title");
} else if (hostname.includes("kitapyurdu.com") && isKitapyurduBookPage()) {
    identifier = getKitapyurduIdentifier();
    // The row holding the store's own stars and review count, under the author.
    targetElement = document.querySelector(".ky-pd-heading__meta");
    insertPosition = "beforeend";

    if (targetElement) {
        targetElement.style.display = "flex";
        targetElement.style.alignItems = "center";
        targetElement.style.gap = "15px";
    }
} else {
    // Every other store: D&R, BKM Kitap, Idefix and the rest declare the book they sell as
    // schema.org data for search engines, ISBN included, so one reader covers them all.
    structuredBook = getStructuredBook();
    if (structuredBook) {
        identifier = structuredBook.isbn;
        targetElement = document.querySelector("h1");
    }
}

// --- PAGE DETECTION ---

function isAmazonBookPage() {
    // Must be a product page URL
    if (!/\/(?:dp|gp\/product)\/[A-Z0-9]{10}/.test(window.location.pathname)) return false;
    // Must have book-specific attributes (ISBN or book details section)
    const hasIsbn = document.querySelector('#rpi-attribute-book_details-isbn13, #rpi-attribute-book_details-isbn10');
    const hasBookBinding = document.querySelector('#rpi-attribute-book_details-binding');
    return !!(hasIsbn || hasBookBinding);
}

function isKitapyurduBookPage() {
    if (!/\/kitap\//.test(window.location.pathname)) return false;
    // Must have an ISBN row in the attributes list
    return getKitapyurduIsbnRows().length > 0;
}

// Kitapyurdu's 2026 redesign replaced the ".attributes table" with label/value pairs.
function getKitapyurduIsbnRows() {
    const rows = document.querySelectorAll(".ky-pd-attributes__item");
    return Array.from(rows).filter(row => {
        const label = row.querySelector(".ky-pd-attributes__label");
        return label && label.innerText.includes("ISBN");
    });
}

// schema.org gives an author as a name, a Person, or a list of either.
function authorName(author) {
    const first = [].concat(author || [])[0];
    if (typeof first === "string") return first;
    return first && typeof first.name === "string" ? first.name : null;
}

// The book a page declares in its JSON-LD: {isbn, title, author}, or null when it declares none.
// An ISBN-13 is an EAN starting 978 or 979, so a gtin13 is only taken when it is one: a store's
// non-book product never passes for a book.
function getStructuredBook() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        // D&R writes raw newlines and tabs inside its description strings, which JSON.parse
        // rejects, so the whole block failed and no box showed. As spaces they parse.
        let data;
        try { data = JSON.parse(script.textContent.replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; }
        const stack = [data];
        while (stack.length) {
            const node = stack.pop();
            if (Array.isArray(node)) { stack.push(...node); continue; }
            if (!node || typeof node !== "object") continue;
            const types = [].concat(node["@type"] || []);
            if (types.includes("Book") || types.includes("Product")) {
                for (const key of ["isbn", "gtin13", "gtin"]) {
                    const value = String(node[key] || "").replace(/[^0-9Xx]/g, "");
                    if (/^97[89]\d{10}$/.test(value) || (key === "isbn" && /^\d{9}[\dXx]$/.test(value))) {
                        return {
                            isbn: value.toUpperCase(),
                            title: typeof node.name === "string" ? node.name : null,
                            author: authorName(node.author)
                        };
                    }
                }
            }
            for (const value of Object.values(node)) {
                if (value && typeof value === "object") stack.push(value);
            }
        }
    }
    return null;
}

// --- EXTRACTION LOGIC ---

function getAmazonIdentifier() {
    const isbn13Node = document.querySelector('#rpi-attribute-book_details-isbn13 .rpi-attribute-value span');
    if (isbn13Node && isbn13Node.innerText) return isbn13Node.innerText.replace(/-/g, '').trim();

    const isbn10Node = document.querySelector('#rpi-attribute-book_details-isbn10 .rpi-attribute-value span');
    if (isbn10Node && isbn10Node.innerText) return isbn10Node.innerText.trim();

    const match = window.location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    return match ? match[1] : null;
}

function getKitapyurduIdentifier() {
    let fallbackIsbn = null;

    for (let row of getKitapyurduIsbnRows()) {
        const value = row.querySelector(".ky-pd-attributes__value");
        const cleanIsbn = value ? value.innerText.replace(/-/g, '').trim() : "";

        if (cleanIsbn.length === 13) {
            return cleanIsbn;
        }

        if (!fallbackIsbn && cleanIsbn) {
            fallbackIsbn = cleanIsbn;
        }
    }
    return fallbackIsbn;
}

// Fallback query for Goodreads; drops edition noise like "(Penguin Classics)".
function getTitle() {
    const node = document.querySelector("#productTitle, h1");
    const text = (structuredBook && structuredBook.title) || (node ? node.innerText : null);
    return text ? text.replace(/\(.*?\)|\[.*?\]/g, "").trim() : null;
}

// Lets Goodreads tell a book from a namesake when it is found by title.
function getAuthor() {
    if (structuredBook && structuredBook.author) return structuredBook.author;
    // Kitapyurdu links the publisher with the same class, only its href says which is which.
    const node = document.querySelector('#bylineInfo .author a, .ky-pd-heading__author[href*="/yazar/"]');
    return node ? node.innerText.trim() : null;
}

// --- UI INJECTION ---

// Lives in a shadow root so the store's stylesheet can't restyle it. It inherits the
// page's font and text color, so it reads as part of whichever store it sits on.
const BADGE_STYLE = `
    :host { all: initial; display: inline-flex; vertical-align: middle; font-family: inherit; font-size: 13px; line-height: 1.2; color: inherit; }
    .badge { display: inline-flex; align-items: center; gap: 8px; padding: 4px 12px 4px 5px; border: 1px solid rgba(128, 128, 128, 0.35); border-radius: 999px; white-space: nowrap; }
    a { display: inline-flex; align-items: center; gap: 6px; color: inherit; text-decoration: none; border-radius: 4px; }
    a:hover .label { text-decoration: underline; }
    a:focus-visible { outline: 2px solid #e87400; outline-offset: 2px; }
    img { width: 16px; height: 16px; border-radius: 3px; flex: none; }
    .rating { font-weight: 600; }
    .muted { opacity: 0.7; }
    .loading img { opacity: 0.5; }
    .stars { position: relative; font-size: 14px; letter-spacing: 1px; color: rgba(128, 128, 128, 0.4); }
    .stars::before { content: "★★★★★"; }
    .stars::after { content: "★★★★★"; position: absolute; left: 0; top: 0; width: var(--fill); overflow: hidden; color: #e87400; }
    .more { all: unset; display: inline-flex; margin: -4px -8px -4px -6px; padding: 4px 6px; border-radius: 999px; cursor: pointer; opacity: 0.6; }
    .more:hover, .more[aria-expanded="true"] { opacity: 1; }
    .more:focus-visible { outline: 2px solid #e87400; }
    .more[aria-expanded="true"] svg { transform: rotate(180deg); }

    /* The panel sits over the store's page, whose colors are unknown, so it brings its own. */
    .panel { position: fixed; z-index: 2147483647; width: 260px; box-sizing: border-box; padding: 14px 16px; background: #fff; color: #1f1f1f; border: 1px solid rgba(0, 0, 0, 0.12); border-radius: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14); white-space: normal; }
    .panel[hidden] { display: none; }
    .head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 10px; }
    .big { font-size: 22px; font-weight: 600; }
    .sub { font-size: 12px; color: #666; text-align: right; }
    .row { display: flex; align-items: center; gap: 8px; margin: 5px 0; font-size: 12px; color: #555; }
    .track { flex: 1; height: 6px; border-radius: 3px; background: #eee; overflow: hidden; }
    .track i { display: block; height: 100%; background: #e87400; }
    .pct { width: 34px; text-align: right; }
    .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .tag { padding: 3px 8px; border-radius: 999px; background: #f2f0eb; color: #5f5e5a; font-size: 11px; }
    .links { display: flex; justify-content: space-between; margin-top: 12px; font-size: 12px; }
    .links a { color: #00635d; }
`;

const CHEVRON = `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const compactNumber = new Intl.NumberFormat("tr", { notation: "compact" });
const fullNumber = new Intl.NumberFormat("tr");

// Genres come from Goodreads' page text, so they are escaped before going into markup.
function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
}

function panelHtml({ rating, count, reviews, dist, genres, url }, reviewsUrl) {
    const total = dist.reduce((sum, n) => sum + n, 0) || 1;
    const rows = [5, 4, 3, 2, 1].map(stars => {
        const pct = Math.round(dist[stars - 1] / total * 100);
        return `<div class="row"><span>${stars}★</span><span class="track"><i style="width: ${pct}%"></i></span><span class="pct">%${pct}</span></div>`;
    }).join("");
    const totals = [count && `${fullNumber.format(count)} oy`, reviews && `${fullNumber.format(reviews)} yorum`].filter(Boolean);

    return `
        <div class="head"><span class="big">${rating}</span><span class="sub">${totals.join(" · ")}</span></div>
        ${rows}
        ${genres && genres.length ? `<div class="tags">${genres.map(genre => `<span class="tag">${escapeHtml(genre)}</span>`).join("")}</div>` : ""}
        <div class="links">
            <a href="${url}" target="_blank" rel="noopener"><span class="label">Goodreads'te aç ↗</span></a>
            <a href="${reviewsUrl}" target="_blank" rel="noopener"><span class="label">Yorumları oku</span></a>
        </div>
    `;
}

// Fixed rather than absolute, so a store's overflow: hidden on the heading can't clip it.
// It follows the badge on scroll, and opens upward when there is no room below.
function wirePanel(root, host) {
    const button = root.querySelector(".more");
    const panel = root.querySelector(".panel");
    const place = () => {
        const badge = root.querySelector(".badge").getBoundingClientRect();
        const below = badge.bottom + 6;
        const fitsBelow = below + panel.offsetHeight <= window.innerHeight;
        panel.style.top = `${fitsBelow ? below : Math.max(6, badge.top - 6 - panel.offsetHeight)}px`;
        panel.style.left = `${Math.max(6, Math.min(badge.left, window.innerWidth - panel.offsetWidth - 6))}px`;
    };
    const setOpen = open => {
        panel.hidden = !open;
        button.setAttribute("aria-expanded", String(open));
        if (open) {
            place();
            window.addEventListener("scroll", place, { passive: true, capture: true });
            window.addEventListener("resize", place);
        } else {
            window.removeEventListener("scroll", place, { capture: true });
            window.removeEventListener("resize", place);
        }
    };

    button.addEventListener("click", () => setOpen(panel.hidden));
    document.addEventListener("click", event => {
        if (!panel.hidden && !event.composedPath().includes(host)) setOpen(false);
    });
    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !panel.hidden) {
            setOpen(false);
            button.focus();
        }
    });
}

function mountBadge(targetNode, position) {
    // A tag of its own, so no store rule aimed at span or div reaches the host and leaks in.
    const host = document.createElement("goodreads-badge");
    host.id = "goodreads-extension-ui";
    if (position === "afterend") host.style.marginTop = "6px";
    targetNode.insertAdjacentElement(position, host);

    const root = host.attachShadow({ mode: "closed" });
    const logoUrl = chrome.runtime.getURL("goodreads-logo.png");
    const render = (html, className = "") => {
        root.innerHTML = `<style>${BADGE_STYLE}</style><span class="badge ${className}">${html}</span>`;
    };

    return {
        showLoading() {
            render(`<img src="${logoUrl}" alt=""><span class="muted">Goodreads puanı aranıyor…</span>`, "loading");
        },

        showRating(book) {
            const { rating, count, url, dist } = book;
            const fill = Math.min(100, Math.max(0, parseFloat(rating) / 5 * 100));
            const reviewsUrl = url.includes("#") ? url : url + "#CommunityReviews";
            render(`
                <a href="${url}" target="_blank" rel="noopener" aria-label="Goodreads puanı ${rating}, Goodreads'te aç">
                    <img src="${logoUrl}" alt="">
                    <span class="stars" style="--fill: ${fill}%" aria-hidden="true"></span>
                    <span class="rating label">${rating}</span>
                </a>
                ${count ? `
                <a href="${reviewsUrl}" target="_blank" rel="noopener" title="${fullNumber.format(count)} oy">
                    <span class="muted label">${compactNumber.format(count)} oy</span>
                </a>` : ""}
                ${dist ? `
                <button class="more" aria-expanded="false" aria-label="Puan dağılımını göster">${CHEVRON}</button>
                <div class="panel" role="dialog" aria-label="Goodreads puan dağılımı" hidden>${panelHtml(book, reviewsUrl)}</div>` : ""}
            `);
            if (dist) wirePanel(root, host);
        },

        showNotFound(query) {
            const searchUrl = `https://www.goodreads.com/search?q=${encodeURIComponent(query)}`;
            render(`
                <a href="${searchUrl}" target="_blank" rel="noopener">
                    <img src="${logoUrl}" alt="">
                    <span class="muted label">Goodreads'te bulunamadı, aramayı aç</span>
                </a>
            `);
        }
    };
}

// --- MAIN EXECUTION ---

const CACHE_DAYS = 30;
// 1.3 stopped trusting the first title search result, so older entries may hold the wrong book;
// 1.4 added the rating distribution and genres.
const CACHE_VERSION = 3;

if (identifier && targetElement && !document.getElementById("goodreads-extension-ui")) {
    const badge = mountBadge(targetElement, insertPosition);
    const title = getTitle();
    badge.showLoading();

    chrome.storage.local.get([identifier], (result) => {
        const cached = result[identifier];
        if (cached && cached.v === CACHE_VERSION && Date.now() - cached.at < CACHE_DAYS * 864e5) {
            badge.showRating(cached);
            return;
        }

        chrome.runtime.sendMessage({ type: "FETCH_RATING", id: identifier, title, author: getAuthor() }, (response) => {
            if (chrome.runtime.lastError || !response || !response.rating) {
                badge.showNotFound(title || identifier);
                return;
            }

            const { rating, count, reviews, dist, genres, url } = response;
            const entry = { rating, count, reviews, dist, genres, url, at: Date.now(), v: CACHE_VERSION };
            chrome.storage.local.set({ [identifier]: entry });
            badge.showRating(entry);
        });
    });
}
