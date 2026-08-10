/**
 * MV3 service worker — lightweight; settings live in chrome.storage
 * and the content script owns the Route Builder / Pano lifecycle.
 */
chrome.runtime.onInstalled.addListener(() => {
  // Defaults are applied lazily by ChromeSettingsStore getters.
});
