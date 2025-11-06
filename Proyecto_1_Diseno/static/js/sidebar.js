const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarOpenBtn = document.getElementById("sidebarOpenBtn");
const mainContent = document.getElementById("mainContent");

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", () => {
    sidebar.classList.remove("open");
    sidebarOpenBtn.style.display = "flex";
  });
}

if (sidebarOpenBtn) {
  sidebarOpenBtn.addEventListener("click", () => {
    sidebar.classList.add("open");
    sidebarOpenBtn.style.display = "none";
  });
}

document.addEventListener("click", (e) => {
  if (!sidebar.contains(e.target) && !sidebarOpenBtn.contains(e.target)) {
    if (sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      sidebarOpenBtn.style.display = "flex";
    }
  }
});

function handleResponsive() {
  if (window.innerWidth <= 768) {
    sidebar.classList.remove("open");
    sidebarOpenBtn.style.display = "flex";
  } else {
    sidebar.classList.remove("open");
    sidebarOpenBtn.style.display = "flex";
  }
}

window.addEventListener("resize", handleResponsive);
handleResponsive();

function createSidebarNavigation() {
  const currentName = getCurrentName();
  const basePath = getBasePath();
  const navigationSidebar = document.getElementById("navigationSidebar");

  if (availableNames.includes(currentName)) {
    availableNames.forEach((name) => {
      const link = document.createElement("a");
      link.className =
        name === currentName ? "sidebar-link active" : "sidebar-link";

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
        // Determinar la ruta actual (realtime, historics o control)
        let currentPath = "/";
        if (window.location.pathname.includes("historics")) {
          currentPath = "/historics/";
        } else if (window.location.pathname.includes("control")) {
          currentPath = "/control/";
        }

        if (basePath === "/test") {
          link.href = `https://${name}.tumaquinaya.com${basePath}${currentPath}`;
        } else {
          link.href = `https://${name}.tumaquinaya.com${currentPath}`;
        }
        link.target = "_self";
      }

      navigationSidebar.appendChild(link);
    });
  } else {
    navigationSidebar.style.display = "none";
  }
}

const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeModal = document.getElementById("closeModal");

if (infoBtn) {
  infoBtn.addEventListener("click", () => {
    infoModal.classList.add("active");
    updateModalInfo();
  });
}

if (closeModal) {
  closeModal.addEventListener("click", () => {
    infoModal.classList.remove("active");
  });
}

if (infoModal) {
  infoModal.addEventListener("click", (e) => {
    if (e.target === infoModal) {
      infoModal.classList.remove("active");
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (infoModal.classList.contains("active")) {
      infoModal.classList.remove("active");
    }
    if (sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      sidebarOpenBtn.style.display = "flex";
    }
  }
});

function updateModalInfo() {
  const lastQuery = document.getElementById("lastQuery");
  const puntosHistoricos = document.getElementById("puntosHistoricos");
  const rangoConsultado = document.getElementById("rangoConsultado");
  const diasIncluidos = document.getElementById("diasIncluidos");

  if (lastQuery) {
    const modalLastQuery = document.getElementById("modalLastQuery");
    if (modalLastQuery) modalLastQuery.textContent = lastQuery.textContent;
  }
  if (puntosHistoricos) {
    const modalPuntos = document.getElementById("modalPuntos");
    if (modalPuntos) modalPuntos.textContent = puntosHistoricos.textContent;
  }
  if (rangoConsultado) {
    const modalRango = document.getElementById("modalRango");
    if (modalRango) modalRango.textContent = rangoConsultado.textContent;
  }
  if (diasIncluidos) {
    const modalDias = document.getElementById("modalDias");
    if (modalDias) modalDias.textContent = diasIncluidos.textContent;
  }
}

window.updateModalInfo = updateModalInfo;
document.addEventListener("DOMContentLoaded", () => {
  createSidebarNavigation();
});