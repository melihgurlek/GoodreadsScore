function getBookIdentifier() {
    const isbn13Node = document.querySelector('#rpi-attribute-book_details-isbn13 .rpi-attribute-value span');
    if (isbn13Node && isbn13Node.innerText) {
        return isbn13Node.innerText.replace(/-/g, '').trim(); 
    }

    const isbn10Node = document.querySelector('#rpi-attribute-book_details-isbn10 .rpi-attribute-value span');
    if (isbn10Node && isbn10Node.innerText) {
        return isbn10Node.innerText.trim();
    }

    const match = window.location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    return match ? match[1] : null;
}

const identifier = getBookIdentifier();

if (identifier) {
    injectSkeleton();

    chrome.storage.local.get([identifier], (result) => {
        if (result[identifier]) {
            console.log("[Goodreads Ext] Loading from cache.");
            const data = result[identifier];
            updateUI(data.rating, data.count, data.url, identifier);
        } else {
            console.log("[Goodreads Ext] Fetching from network...");
            chrome.runtime.sendMessage({ type: "FETCH_RATING", asin: identifier }, (response) => {
                if (chrome.runtime.lastError || !response || !response.rating) {
                    updateUI("N/A", null, null, identifier);
                    return;
                }

                let cacheData = {};
                cacheData[identifier] = {
                    rating: response.rating,
                    count: response.count,
                    url: response.url
                };
                chrome.storage.local.set(cacheData);

                updateUI(response.rating, response.count, response.url, identifier);
            });
        }
    });
}

function injectSkeleton() {
    if (document.getElementById("goodreads-extension-ui")) return;

    const targetElement = document.getElementById("bylineInfo") || document.getElementById("title");
    if (!targetElement) return;

    const skeletonDiv = document.createElement("div");
    skeletonDiv.id = "goodreads-extension-ui";
    
    skeletonDiv.style.display = "inline-flex";
    skeletonDiv.style.alignItems = "center";
    skeletonDiv.style.marginTop = "4px";
    skeletonDiv.style.marginBottom = "8px";
    skeletonDiv.style.fontFamily = "inherit";
    skeletonDiv.style.color = "#555";
    skeletonDiv.style.fontSize = "14px";
    
    const logoUrl = chrome.runtime.getURL("goodreads-logo.png");

    skeletonDiv.innerHTML = `
        <img src="${logoUrl}" alt="Goodreads" style="height: 16px; margin-right: 8px; border-radius: 2px; opacity: 0.5;">
        <span style="font-style: italic;">Fetching rating...</span>
    `;

    targetElement.insertAdjacentElement("afterend", skeletonDiv);
}

function updateUI(rating, count, url, identifier) {
    const container = document.getElementById("goodreads-extension-ui");
    if (!container) return; // Failsafe

    const finalUrl = url || `https://www.goodreads.com/search?q=${identifier}`;
    
    const reviewsUrl = finalUrl.includes('#') ? finalUrl : finalUrl + "#CommunityReviews"; 
    
    const logoUrl = chrome.runtime.getURL("goodreads-logo.png");

    container.innerHTML = `
        <a href="${finalUrl}" target="_blank" style="display: inline-flex; align-items: center; text-decoration: none; color: inherit; margin-right: 4px;" onmouseover="this.style.opacity='0.8'" onmouseout="this.style.opacity='1'">
            <img src="${logoUrl}" alt="Goodreads" style="height: 16px; margin-right: 8px; border-radius: 2px;">
            <span style="font-size: 14px; font-weight: 500; color: #0F1111;">${rating}</span>
            <span style="color: #DE7921; font-size: 16px; margin-left: 4px;">★</span>
        </a>
        ${count ? `
        <a href="${reviewsUrl}" target="_blank" style="display: inline-flex; align-items: center; text-decoration: none; color: #007185; font-size: 14px; margin-left: 4px;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">
            ${count} ratings
        </a>` : ''}
    `;
    
    container.style.color = "inherit";
}