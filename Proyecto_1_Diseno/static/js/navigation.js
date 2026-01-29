// static/js/navigation.js

const availableNames = ["oliver", "alan", "sebastian", "hernando"];

function getBasePath() {
  return window.BASE_PATH || "";
}

function getCurrentName() {
  const hostname = window.location.hostname;
  const subdomain = hostname.split(".")[0];

  if (availableNames.includes(subdomain.toLowerCase())) {
    return subdomain.toLowerCase();
  }

  const title = document.title.toLowerCase();
  for (const name of availableNames) {
    if (title.includes(name)) {
      return name;
    }
  }
  return "oliver";
}

function isHistoricalView() {
  return window.location.pathname.includes("/historics");
}

function isControlView() {
  return window.location.pathname.includes("/control");
}

function isRutasView() {
  return window.location.pathname.includes("/rutas");
}

function setupViewNavigation() {
  const basePath = getBasePath();

  const realtimeLink = document.getElementById("realtimeLink");
  if (realtimeLink) {
    realtimeLink.href = basePath ? `${basePath}/` : "/";
    realtimeLink.onclick = null;
  }

  const historicalLink = document.getElementById("historicalLink");
  if (historicalLink) {
    historicalLink.href = basePath ? `${basePath}/historics/` : "/historics/";
    historicalLink.onclick = null;
  }

  const controlLink = document.getElementById("controlLink");
  if (controlLink) {
    controlLink.href = basePath ? `${basePath}/control/` : "/control/";
    controlLink.onclick = null;
  }

  // NUEVO: Configurar link de Gestión de Rutas
  const rutasLink = document.getElementById("rutasLink");
  if (rutasLink) {
    rutasLink.href = basePath ? `${basePath}/rutas/` : "/rutas/";
    rutasLink.onclick = null;
  }
}

function createModalNavigation() {
  const modalNavigation = document.getElementById("modalNavigation");

  if (!modalNavigation) {
    return;
  }

  const currentName = getCurrentName();
  const basePath = getBasePath();

  modalNavigation.innerHTML = "";

  if (availableNames.includes(currentName)) {
    availableNames.forEach((name) => {
      const link = document.createElement("a");
      link.className =
        name === currentName ? "nav-modal-link active" : "nav-modal-link";

      const emoji = {
        oliver: "🖥️",
        alan: "🖥️",
        sebastian: "🖥️",
        hernando: "🖥️",
      };

      link.innerHTML = `
                <span class="link-icon">${emoji[name] || "📌"}</span>
                ${name.charAt(0).toUpperCase() + name.slice(1)}
            `;

      if (name !== currentName) {
        // Determinar la ruta actual (realtime, historics, control o rutas)
        let currentPath = "/";
        if (isHistoricalView()) {
          currentPath = "/historics/";
        } else if (isControlView()) {
          currentPath = "/control/";
        } else if (isRutasView()) {
          currentPath = "/rutas/";
        }

        if (basePath === "/test") {
          link.href = `https://${name}.tumaquinaya.com${basePath}${currentPath}`;
        } else {
          link.href = `https://${name}.tumaquinaya.com${currentPath}`;
        }
        link.target = "_self";
      } else {
        link.style.cursor = "default";
        link.onclick = (e) => e.preventDefault();
      }

      modalNavigation.appendChild(link);
    });
  } else {
    modalNavigation.innerHTML =
      '<p style="padding: 1rem; text-align: center; color: #666;">Navegación no disponible</p>';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupViewNavigation();
  createModalNavigation();
});

window.getBasePath = getBasePath;
window.getCurrentName = getCurrentName;
window.setupViewNavigation = setupViewNavigation;
window.createModalNavigation = createModalNavigation;
window.availableNames = availableNames;
window.isHistoricalView = isHistoricalView;
window.isControlView = isControlView;
window.isRutasView = isRutasView; // NUEVO: Exportar función