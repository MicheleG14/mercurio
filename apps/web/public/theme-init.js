// Applies the saved theme before the first paint, so the page never flashes the wrong colours.
// A separate file (not an inline script) so the Content Security Policy can forbid inline scripts.
(function () {
  try {
    var saved = localStorage.getItem('mercurio.theme');
    var dark =
      saved === 'dark' ||
      ((saved === null || saved === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  } catch (e) {
    // storage unavailable: the app applies the system theme once it starts
  }
})();
