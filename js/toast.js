// Notifications toast (bas d'écran), avec bouton d'action optionnel (ex. "Annuler").

let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.className = "toast-container";
    toastContainer.setAttribute("aria-live", "polite");
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, { actionLabel, onAction, duration = 4500 } = {}) {
  const container = ensureToastContainer();
  const toast = document.createElement("div");
  toast.className = "toast glass";

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;
  toast.appendChild(text);

  let timer;

  function dismiss() {
    clearTimeout(timer);
    toast.classList.remove("visible");
    toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500); // filet de sécurité si transitionend ne se déclenche pas
  }

  if (actionLabel && onAction) {
    const actionBtn = document.createElement("button");
    actionBtn.type = "button";
    actionBtn.className = "toast-action";
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", () => {
      onAction();
      dismiss();
    });
    toast.appendChild(actionBtn);
  }

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "toast-close";
  closeBtn.setAttribute("aria-label", "Fermer la notification");
  closeBtn.textContent = "×";
  closeBtn.addEventListener("click", () => dismiss());
  toast.appendChild(closeBtn);

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));

  timer = setTimeout(dismiss, duration);

  return dismiss;
}
