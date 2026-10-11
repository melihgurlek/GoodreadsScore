// --- SITE ROUTER ---
const hostname = window.location.hostname;
let identifier = null;
let targetElement = null;
let insertPosition = "afterend"; 
let structuredTitle = null;

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
    const book = getStructuredBook();
    if (book) {
        identifier = book.isbn;
        structuredTitle = book.title;
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
    // Product pages contain /p- in the URL
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

// The book a page declares in its JSON-LD: {isbn, title}, or null when it declares none.
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
                        return { isbn: value.toUpperCase(), title: typeof node.name === "string" ? node.name : null };
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
    const text = structuredTitle || (node ? node.innerText : null);
    return text ? text.replace(/\(.*?\)|\[.*?\]/g, "").trim() : null;
}

// --- MAIN EXECUTION ---

const CACHE_DAYS = 30;

if (identifier && targetElement) {
    injectSkeleton(targetElement, insertPosition);

    chrome.storage.local.get([identifier], (result) => {
        // Ratings move slowly but they do move, and entries from before 1.2 carry no date.
        const cached = result[identifier];
        if (cached && cached.at && Date.now() - cached.at < CACHE_DAYS * 864e5) {
            const data = result[identifier];
            updateUI(data.rating, data.count, data.url, identifier, targetElement);
        } else {
            chrome.runtime.sendMessage({ type: "FETCH_RATING", asin: identifier, title: getTitle() }, (response) => {
                if (chrome.runtime.lastError || !response || !response.rating) {
                    updateUI("N/A", null, null, identifier, targetElement);
                    return;
                }

                let cacheData = {};
                cacheData[identifier] = {
                    rating: response.rating,
                    count: response.count,
                    url: response.url,
                    at: Date.now()
                };
                chrome.storage.local.set(cacheData);

                updateUI(response.rating, response.count, response.url, identifier, targetElement);
            });
        }
    });
}

// --- UI INJECTION ---

function injectSkeleton(targetNode, position) {
    if (document.getElementById("goodreads-extension-ui")) return;

    const skeletonDiv = document.createElement("div");
    skeletonDiv.id = "goodreads-extension-ui";
    
    skeletonDiv.style.display = "inline-flex";
    skeletonDiv.style.alignItems = "center";
    skeletonDiv.style.alignItems = "center";
    
    if (position === "afterend") {
        skeletonDiv.style.marginTop = "6px";
    }
    
    skeletonDiv.style.fontFamily = "inherit";
    
    skeletonDiv.style.fontFamily = "inherit";
    skeletonDiv.style.color = "#555";
    skeletonDiv.style.fontSize = "14px";
    
    const logoUrl = chrome.runtime.getURL("goodreads-logo.png");

    skeletonDiv.innerHTML = `
        <img src="${logoUrl}" alt="Goodreads" style="height: 16px; margin-right: 8px; border-radius: 2px; opacity: 0.5;">
        <span style="font-style: italic;">Fetching rating...</span>
    `;

    targetNode.insertAdjacentElement(position, skeletonDiv);
}

function updateUI(rating, count, url, identifier, targetNode) {
    const container = document.getElementById("goodreads-extension-ui");
    if (!container) return; 

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