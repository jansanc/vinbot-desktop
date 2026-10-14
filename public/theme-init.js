// A file, not an inline script: the page's CSP is script-src 'self'.
try {
  var saved = localStorage.getItem("theme");
  var theme = saved || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.classList.add(theme);
} catch (e) {}
