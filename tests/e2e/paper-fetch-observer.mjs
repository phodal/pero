// Install before the App iframe/SDK exists. Its captured fetch stays stable;
// a named disposable observer can hold the real native response later.
export function installPaperFetchObserver() {
  if (window.paperNativeFetch) return;
  const native = window.paperNativeFetch = window.fetch;
  window.fetch = (...args) => (window.paperFetchObserver ?? native).apply(window, args);
}
