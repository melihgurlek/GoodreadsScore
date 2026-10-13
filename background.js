const GOODREADS = "https://www.goodreads.com";

// Too many searches and Goodreads answers with an empty 202 (its bot check) or a 429/503
// instead of the page. That is not "no such book", so it surfaces as its own error.
class BlockedError extends Error {}

async function fetchPage(url) {
    const response = await fetch(url);
    const html = await response.text();
    if ([202, 429, 503].includes(response.status) || !html) throw new BlockedError(`${response.status} for ${url}`);
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

// The rows of a search results page: [{path, title, authors, count}].
function parseResults(html) {
    return html.split('itemtype="http://schema.org/Book"').slice(1).map(row => {
        const link = row.match(/class="bookTitle"[^>]*href="(\/book\/show\/[^"?]+)/);
        const title = row.match(/<span itemprop='name'[^>]*>([^<]+)/);
        const count = row.match(/([\d,]+) ratings?</);
        return {
            path: link ? link[1] : null,
            title: title ? decodeEntities(title[1]) : null,
            authors: [...row.matchAll(/class="authorName"[^>]*><span itemprop="name">([^<]+)/g)].map(m => decodeEntities(m[1])),
            count: count ? parseCount(count[1]) : 0
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
function pickBook(books, title, author) {
    const scored = books.map(book => {
        const titleFit = titleScore(title, book.title);
        const authorFit = sameAuthor(author, book.authors);
        const score = titleFit + (authorFit === true ? 0.25 : authorFit === false ? -0.3 : 0);
        return { book, titleFit, score };
    }).filter(entry => entry.titleFit >= 0.6 && entry.score >= 0.6);
    if (!scored.length) return null;

    const best = Math.max(...scored.map(entry => entry.score));
    return scored
        .filter(entry => entry.score >= best - 0.05)
        .sort((a, b) => (b.book.count || 0) - (a.book.count || 0))[0].book;
}

// --- LOOKUP ---

// A search either lands straight on a book page or lists results; either way, the books.
async function search(query) {
    const page = await fetchPage(`${GOODREADS}/search?q=${encodeURIComponent(query)}`);
    const book = parseBookPage(page);
    return book ? [book] : parseResults(page.html);
}

// Search rows only carry a path; a book page already has its rating.
async function openBook(book) {
    return book.rating ? book : parseBookPage(await fetchPage(GOODREADS + book.path));
}

async function findBook({ id, title, author }) {
    // A book reached straight from its ISBN or ASIN is the book. Search result cards on
    // Kitapyurdu carry neither, only a title.
    const byId = id ? await search(id) : [];
    if (byId.length && byId[0].rating) return byId[0];
    if (!title) return byId.length ? openBook(byId[0]) : null;

    // Goodreads' ISBN search started returning 0 results (Sep 2026), so fall back to the title.
    // Only its main part is searched: Goodreads finds nothing for "Değirmen - Bütün Yapıtları
    // Sabahattin Ali", but "Değirmen Sabahattin Ali" works, and pickBook still weighs the
    // whole title. Adding the author pushes the right book up for short titles, but can also
    // narrow the results to lesser editions ("Suç ve Ceza 2.Cilt"), so both searches are pooled.
    const main = title.split(/:|\s[-–]\s/)[0].trim() || title;
    const queries = author ? [`${main} ${author}`, main] : [main];
    const candidates = byId.concat(...await Promise.all(queries.map(search)));
    const match = pickBook(candidates, title, author);
    return match ? openBook(match) : null;
}

// Once blocked, asking again only prolongs it, so lookups pause for a while. The worker may
// be restarted meanwhile and forget; then the next lookup finds out again.
const BLOCK_PAUSE_MS = 5 * 60 * 1000;
let blockedUntil = 0;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "FETCH_RATING" && (request.id || request.title)) {
        if (Date.now() < blockedUntil) {
            sendResponse({ rating: null, blocked: true });
            return;
        }

        findBook(request)
            .then(result => sendResponse(result || { rating: null }))
            .catch(error => {
                if (error instanceof BlockedError) {
                    blockedUntil = Date.now() + BLOCK_PAUSE_MS;
                    console.warn("[Goodreads Ext] Goodreads is refusing requests, pausing:", error.message);
                    sendResponse({ rating: null, blocked: true });
                    return;
                }
                console.error("[Goodreads Ext] Error:", error);
                sendResponse({ rating: null });
            });

        return true;
    }
});
