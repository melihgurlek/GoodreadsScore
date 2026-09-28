function fetchPage(url) {
    return fetch(url).then(response => response.text().then(html => ({ html, finalUrl: response.url })));
}

function parseRating({ html, finalUrl }) {
    const ratingMatch = html.match(/class="RatingStatistics__rating"[^>]*>([\d.]+)</)
                     || html.match(/"ratingValue":\s*"?([\d.]+)"?/);
    if (!ratingMatch) return null;

    const countMatch = html.match(/data-testid="ratingsCount"[^>]*>\s*([\d.,\s]+)/i)
                     || html.match(/"ratingCount":\s*"?([\d]+)"?/);

    let formattedCount = "";
    if (countMatch && countMatch[1]) {
        const rawNumber = parseInt(countMatch[1].replace(/,/g, ''), 10);
        if (!isNaN(rawNumber)) {
            formattedCount = rawNumber.toLocaleString();
        }
    }
    return { rating: ratingMatch[1], count: formattedCount, url: finalUrl };
}

// Search lands on the book page directly, or on a results list; then open the first result.
// ponytail: first result is trusted as the right book, compare titles if mismatches show up.
async function lookup(query) {
    const page = await fetchPage(`https://www.goodreads.com/search?q=${encodeURIComponent(query)}`);
    const direct = parseRating(page);
    if (direct) return direct;

    const firstBook = page.html.match(/href="(\/book\/show\/[^"?]+)/);
    return firstBook ? parseRating(await fetchPage(`https://www.goodreads.com${firstBook[1]}`)) : null;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "FETCH_RATING" && request.asin) {
        // Goodreads' ISBN search started returning 0 results (Sep 2026), so fall back to the title.
        lookup(request.asin)
            .then(result => result || (request.title ? lookup(request.title) : null))
            .then(result => sendResponse(result || { rating: null }))
            .catch(error => {
                console.error("[Goodreads Ext] Error:", error);
                sendResponse({ rating: null });
            });

        return true;
    }
});
