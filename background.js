const GOODREADS = "https://www.goodreads.com";

// Too many searches and Goodreads answers with an empty 202 (its bot check) or a 429/503
// instead of the page. That is not "no such book", so it surfaces as its own error.
class BlockedError extends Error {}

// Once blocked, asking again only prolongs it, so requests pause for a while. Goodreads
// blocks its pages and its search box JSON separately (the JSON kept answering while
// results pages got 202s), so each kind pauses on its own. The worker may be restarted
// meanwhile and forget; then the next request finds out again.
const BLOCK_PAUSE_MS = 5 * 60 * 1000;
const blockedUntil = { page: 0, quick: 0 };

async function fetchPage(url, kind = "page") {
    if (Date.now() < blockedUntil[kind]) throw new BlockedError(`paused, skipping ${url}`);
    const response = await fetch(url);
    const html = await response.text();
    if ([202, 429, 503].includes(response.status) || !html) {
        blockedUntil[kind] = Date.now() + BLOCK_PAUSE_MS;
        throw new BlockedError(`${response.status} for ${url}`);
    }
    return { html, finalUrl: response.url };
}

// Service workers have no DOMParser, and Goodreads escapes non-ASCII titles as entities.
function decodeEntities(text) {
    return text
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .trim();
}

function parseCount(text) {
    const number = parseInt(String(text).replace(/[^\d]/g, ""), 10);
    return isNaN(number) ? null : number;
}

// A book page: {rating, count, url, title, authors}, or null when the page is not one.
function parseBookPage({ html, finalUrl }) {
    const ratingMatch = html.match(/class="RatingStatistics__rating"[^>]*>([\d.]+)</)
                     || html.match(/"ratingValue":\s*"?([\d.]+)"?/);
    if (!ratingMatch) return null;

    const countMatch = html.match(/data-testid="ratingsCount"[^>]*>\s*([\d.,\s]+)/i)
                     || html.match(/"ratingCount":\s*"?([\d]+)"?/);
    const titleMatch = html.match(/data-testid="bookTitle"[^>]*>([^<]+)/);
    const reviewsMatch = html.match(/data-testid="reviewsCount"[^>]*>\s*([\d.,]+)/);
    const count = countMatch ? parseCount(countMatch[1]) : null;

    return {
        rating: ratingMatch[1],
        count,
        reviews: reviewsMatch ? parseCount(reviewsMatch[1]) : null,
        dist: parseDistribution(html, count),
        genres: [...html.matchAll(/BookPageMetadataSection__genreButton"><a [^>]*><span class="Button__labelItem">([^<]+)/g)]
            .map(m => decodeEntities(m[1])).slice(0, 3),
        url: finalUrl,
        title: titleMatch ? decodeEntities(titleMatch[1]) : null,
        authors: [...html.matchAll(/data-testid="name">([^<]+)/g)].map(m => decodeEntities(m[1]))
    };
}

// Ratings per star, 1★ first. The page's data also holds the works of other books it links
// to (the rest of a series), so the list whose total is the book's own count is the one.
function parseDistribution(html, count) {
    const lists = [...html.matchAll(/"ratingsCountDist":\[(\d+),(\d+),(\d+),(\d+),(\d+)\]/g)]
        .map(m => m.slice(1).map(Number));
    if (!lists.length) return null;
    const total = list => list.reduce((sum, n) => sum + n, 0);
    return count == null ? lists[0]
        : lists.reduce((best, list) => Math.abs(total(list) - count) < Math.abs(total(best) - count) ? list : best);
}

// The rows of a search results page: [{path, url, title, authors, rating, count}]. A row
// carries the same work-wide rating and count as the book page, so a badge can show it
// without fetching that page; only the distribution and genres need it.
function parseResults(html) {
    return html.split('itemtype="http://schema.org/Book"').slice(1).map(row => {
        const link = row.match(/class="bookTitle"[^>]*href="(\/book\/show\/[^"?]+)/);
        const title = row.match(/<span itemprop='name'[^>]*>([^<]+)/);
        const rating = row.match(/([\d.]+) avg rating/);
        const count = row.match(/([\d,]+) ratings?</);
        return {
            path: link ? link[1] : null,
            url: link ? GOODREADS + link[1] : null,
            title: title ? decodeEntities(title[1]) : null,
            authors: [...row.matchAll(/class="authorName"[^>]*><span itemprop="name">([^<]+)/g)].map(m => decodeEntities(m[1])),
            rating: rating ? rating[1] : null,
            count: count ? parseCount(count[1]) : null
        };
    }).filter(book => book.path && book.title);
}

// --- MATCHING ---

// Lowercase words without accents, so "Kürk Mantolu" and "Kurk mantolu" compare equal.
// Series notes like "(Harry Potter, #1)" are dropped: Goodreads adds them, stores don't.
function words(text) {
    return (text || "").toLocaleLowerCase("tr").replace(/ı/g, "i")
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/\(.*?\)|\[.*?\]/g, " ")
        .split(/[^a-z0-9]+/).filter(Boolean);
}

// Dice coefficient of two word lists: 1 for the same words, 0 for none in common.
function overlap(a, b) {
    const setA = new Set(a), setB = new Set(b);
    if (!setA.size || !setB.size) return 0;
    const shared = [...setA].filter(word => setB.has(word)).length;
    return 2 * shared / (setA.size + setB.size);
}

// Either side may carry a subtitle the other lacks ("Sapiens" vs "Sapiens: A Brief History…",
// "Değirmen - Bütün Yapıtları" vs "Değirmen"), so the parts before a colon or dash are
// compared too.
function titleScore(wanted, found) {
    const main = text => words(text.split(/:|\s[-–]\s/)[0]);
    return Math.max(overlap(words(wanted), words(found)), overlap(main(wanted), main(found)));
}

// Compares surnames by their first four letters, which survives transliteration
// (Dostoyevski / Dostoevsky). null when the store gave no author.
function sameAuthor(wanted, authors) {
    const surname = words(wanted).pop();
    if (!surname) return null;
    const stem = surname.slice(0, 4);
    return authors.some(author => words(author).some(word => word.startsWith(stem)));
}

// The candidate that is the book asked for, or null. Searching "Kürk Mantolu Madonna" ranks an
// omnibus that contains it first, and it only shares a third of its words with the title,
// so a close title is required, the author settles near-ties, and of equally good matches
// the most rated one wins, being the edition people mean.
// With sure, only a near-exact title by a matching author counts: enough to stop searching
// on a few candidates, where a loose fit might be a lesser book beating one not yet seen.
function pickBook(books, title, author, { sure = false } = {}) {
    const scored = books.map(book => {
        const titleFit = titleScore(title, book.title);
        const authorFit = sameAuthor(author, book.authors);
        const score = titleFit + (authorFit === true ? 0.25 : authorFit === false ? -0.3 : 0);
        return { book, titleFit, authorFit, score };
    }).filter(entry => entry.titleFit >= 0.6 && entry.score >= 0.6
        && (!sure || (entry.titleFit >= 0.9 && entry.authorFit !== false)));
    if (!scored.length) return null;

    const best = Math.max(...scored.map(entry => entry.score));
    return scored
        .filter(entry => entry.score >= best - 0.05)
        .sort((a, b) => (b.book.count || 0) - (a.book.count || 0))[0].book;
}

// --- LOOKUP ---

// Every search row seen while the worker lives. A results page on a store tends to list one
// author or series, and a search for one of its books brings up the others, so later cards
// are often found here without asking Goodreads at all.
const seenRows = new Map();
const SEEN_ROWS_MAX = 1000;

function remember(rows) {
    for (const row of rows) {
        if (!row.path) continue;
        seenRows.delete(row.path);
        seenRows.set(row.path, row);
    }
    while (seenRows.size > SEEN_ROWS_MAX) seenRows.delete(seenRows.keys().next().value);
    return rows;
}

// A search either lands straight on a book page or lists results; either way, the books.
async function search(query) {
    const page = await fetchPage(`${GOODREADS}/search?q=${encodeURIComponent(query)}`);
    const book = parseBookPage(page);
    return book ? [book] : remember(parseResults(page.html));
}

// The JSON behind Goodreads' search box: five rows with the work's rating and count, in
// about 4 KB and a second, against 190 KB and two for a results page. It isn't a public
// API, so anything unexpected reads as no rows and the results page is searched instead.
async function quickSearch(query) {
    const { html } = await fetchPage(`${GOODREADS}/book/auto_complete?format=json&q=${encodeURIComponent(query)}`, "quick");
    let books;
    try { books = JSON.parse(html); } catch { return []; }
    if (!Array.isArray(books)) return [];
    return remember(books.map(book => {
        const path = typeof book.bookUrl === "string" ? book.bookUrl.split("?")[0] : null;
        return {
            path,
            url: path ? GOODREADS + path : null,
            title: book.bookTitleBare || book.title,
            authors: book.author && book.author.name ? [book.author.name] : [],
            rating: Number(book.avgRating).toFixed(2),
            count: Number(book.ratingsCount) || 0
        };
    // An edition nobody has rated reads 0.00, which is no rating at all.
    }).filter(book => book.path && book.title && book.count > 0));
}

// A search row is enough for the badge; its book page is only opened when the row's
// rating could not be read.
async function openBook(book) {
    return book.rating ? book : parseBookPage(await fetchPage(book.url));
}

async function findBook({ id, title, author }) {
    // A book reached straight from its ISBN or ASIN is the book: a book page, which unlike a
    // search row has no path. Search result cards on Kitapyurdu carry neither, only a title.
    const byId = id ? await search(id) : [];
    if (byId.length && !byId[0].path) return byId[0];
    if (!title) return byId.length ? openBook(byId[0]) : null;

    // Goodreads' ISBN search started returning 0 results (Sep 2026), so fall back to the title.
    // Only its main part is searched: Goodreads finds nothing for "Değirmen - Bütün Yapıtları
    // Sabahattin Ali", but "Değirmen Sabahattin Ali" works, and pickBook still weighs the
    // whole title. Adding the author pushes the right book up for short titles, but can also
    // narrow the results to lesser editions ("Suç ve Ceza 2.Cilt"), so both searches are pooled.
    const main = title.split(/:|\s[-–]\s/)[0].trim() || title;
    const query = author ? `${main} ${author}` : main;

    // Cheapest first: rows already seen, then the search box's five, and only when neither
    // has the book for sure, the full results pages.
    const seen = pickBook([...seenRows.values()], title, author, { sure: true });
    if (seen) return openBook(seen);
    // A blocked search box leaves the results pages, which may still answer.
    const quick = await quickSearch(query).catch(error => {
        if (error instanceof BlockedError) return [];
        throw error;
    });
    const quickMatch = pickBook(quick, title, author, { sure: true });
    if (quickMatch) return openBook(quickMatch);

    const queries = author ? [query, main] : [main];
    const candidates = byId.concat(quick, ...await Promise.all(queries.map(search)));
    const match = pickBook(candidates, title, author);
    return match ? openBook(match) : null;
}

// Answers a lookup, turning Goodreads' refusal into {blocked}.
function respond(lookup, sendResponse) {
    lookup()
        .then(result => sendResponse(result || { rating: null }))
        .catch(error => {
            if (error instanceof BlockedError) {
                console.warn("[Goodreads Ext] Goodreads is refusing requests:", error.message);
                sendResponse({ rating: null, blocked: true });
                return;
            }
            console.error("[Goodreads Ext] Error:", error);
            sendResponse({ rating: null });
        });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "FETCH_RATING" && (request.id || request.title)) {
        respond(() => findBook(request), sendResponse);
        return true;
    }
    // The book page behind a badge found from a search row, for its distribution and genres.
    if (request.type === "FETCH_DETAILS" && String(request.url).startsWith(`${GOODREADS}/book/show/`)) {
        respond(async () => parseBookPage(await fetchPage(request.url)), sendResponse);
        return true;
    }
});
