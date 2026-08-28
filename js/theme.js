// Bascule thème clair/sombre, persistée. Appliquée le plus tôt possible (voir index.html)
// pour éviter un flash de mauvais thème au chargement.

const THEME_KEY = "tcgp_theme";

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.textContent = theme === "light" ? "🌙 Sombre" : "☀️ Clair";
    btn.setAttribute("aria-pressed", String(theme === "light"));
  }
}

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function toggleTheme() {
  const next = currentTheme() === "light" ? "dark" : "light";
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // pas bloquant : le thème reste actif pour la session en cours
  }
  applyTheme(next);
}

function initThemeToggleButton() {
  applyTheme(currentTheme());
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.addEventListener("click", toggleTheme);
}
