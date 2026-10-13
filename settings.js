// Shared by the content script and the popup. Kept in storage.sync so the choices follow the
// user's Chrome profile; the ratings cache stays in storage.local.
const DEFAULT_SETTINGS = {
    sites: { amazon: true, kitapyurdu: true, other: true },
    // Off by default: a results page has no ISBNs, so each card costs Goodreads two or three
    // title searches.
    searchResults: false
};

function siteGroup(hostname) {
    if (hostname.includes("amazon")) return "amazon";
    if (hostname.includes("kitapyurdu.com")) return "kitapyurdu";
    return "other";
}

function loadSettings(callback) {
    chrome.storage.sync.get("settings", ({ settings = {} }) => {
        callback({
            sites: { ...DEFAULT_SETTINGS.sites, ...settings.sites },
            searchResults: settings.searchResults ?? DEFAULT_SETTINGS.searchResults
        });
    });
}

function saveSettings(settings) {
    chrome.storage.sync.set({ settings });
}
