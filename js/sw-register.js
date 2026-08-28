// Enregistrement du service worker (PWA : installable + fonctionne hors-ligne après une
// première visite). Échoue silencieusement si non supporté (ex. navigateurs anciens).

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch((err) => {
      console.error("Échec de l'enregistrement du service worker :", err);
    });
  });
}
