// --- SITE ROUTER ---
const hostname = window.location.hostname;
let identifier = null;
let targetElement = null;
let insertPosition = "afterend"; 

if (hostname.includes("amazon")) {
    identifier = getAmazonIdentifier();
    targetElement = document.getElementById("bylineInfo") || document.getElementById("title");
} else if (hostname.includes("kitapyurdu.com")) {
    identifier = getKitapyurduIdentifier();
    targetElement = document.querySelector(".rating"); 
    insertPosition = "beforeend"; 
    
    if (targetElement) {
        targetElement.style.display = "flex";
        targetElement.style.alignItems = "center";
        targetElement.style.gap = "15px"; 
        
        const starList = targetElement.querySelector("ul");
        if (starList) {
            starList.style.marginBottom = "0";
            starList.style.paddingBottom = "0";
        }
    }
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
    const rows = document.querySelectorAll(".attributes table tr");
    
    for (let row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length === 2 && cells[0].innerText.includes("ISBN:")) {
            return cells[1].innerText.trim();
        }
    }
    return null;
}

// --- MAIN EXECUTION ---

if (identifier && targetElement) {
    injectSkeleton(targetElement, insertPosition);

    chrome.storage.local.get([identifier], (result) => {
        if (result[identifier]) {
            const data = result[identifier];
            updateUI(data.rating, data.count, data.url, identifier, targetElement);
        } else {
            chrome.runtime.sendMessage({ type: "FETCH_RATING", asin: identifier }, (response) => {
                if (chrome.runtime.lastError || !response || !response.rating) {
                    updateUI("N/A", null, null, identifier, targetElement);
                    return;
                }

                let cacheData = {};
                cacheData[identifier] = {
                    rating: response.rating,
                    count: response.count,
                    url: response.url
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