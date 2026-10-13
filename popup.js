const siteBoxes = document.querySelectorAll("[data-site]");
const searchResultsBox = document.getElementById("search-results");
const cacheCount = document.getElementById("cache-count");

document.getElementById("version").textContent = "v" + chrome.runtime.getManifest().version;

loadSettings(settings => {
    siteBoxes.forEach(box => { box.checked = settings.sites[box.dataset.site]; });
    searchResultsBox.checked = settings.searchResults;

    const save = () => {
        siteBoxes.forEach(box => { settings.sites[box.dataset.site] = box.checked; });
        settings.searchResults = searchResultsBox.checked;
        saveSettings(settings);
    };
    siteBoxes.forEach(box => box.addEventListener("change", save));
    searchResultsBox.addEventListener("change", save);
});

// Everything in storage.local is a cached rating; the settings live in storage.sync.
function showCacheCount() {
    chrome.storage.local.get(null, items => {
        const count = Object.keys(items).length;
        cacheCount.textContent = count ? `${count.toLocaleString("tr")} kitap önbellekte` : "Önbellek boş";
    });
}

document.getElementById("clear-cache").addEventListener("click", () => {
    chrome.storage.local.clear(showCacheCount);
});

showCacheCount();
