chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "FETCH_RATING" && request.asin) {
        const searchUrl = `https://www.goodreads.com/search?q=${request.asin}`;

        fetch(searchUrl)
            .then(response => {
                const finalUrl = response.url;
                return response.text().then(html => ({ html, finalUrl }));
            })
            .then(({ html, finalUrl }) => {
                const ratingMatch = html.match(/class="RatingStatistics__rating"[^>]*>([\d.]+)</) 
                                 || html.match(/"ratingValue":\s*"?([\d.]+)"?/);

                const countMatch = html.match(/data-testid="ratingsCount"[^>]*>\s*([\d,]+)(?:\s|&nbsp;)*ratings/i) 
                                || html.match(/"ratingCount":\s*(\d+)/);

                let formattedCount = "";
                if (countMatch && countMatch[1]) {
                    const rawNumber = parseInt(countMatch[1].replace(/,/g, ''), 10);
                    if (!isNaN(rawNumber)) {
                        formattedCount = rawNumber.toLocaleString();
                    }
                }

                if (ratingMatch && ratingMatch[1]) {
                    sendResponse({ 
                        rating: ratingMatch[1],
                        count: formattedCount,
                        url: finalUrl 
                    });
                } else {
                    sendResponse({ rating: null });
                }
            })
            .catch(error => {
                console.error("[Goodreads Ext] Error:", error);
                sendResponse({ rating: null });
            });

        return true; 
    }
});