const sidebar = document.getElementById("sidebar");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarOpenBtn = document.getElementById("sidebarOpenBtn");
const mainContent = document.getElementById("mainContent");

const openSidebar = () => {
  sidebar.classList.add("open");
  sidebarOpenBtn.style.opacity = "0";
  sidebarOpenBtn.style.pointerEvents = "none";
  setTimeout(() => {
    sidebarOpenBtn.style.display = "none";
  }, 300);
};

const closeSidebar = () => {
  sidebar.classList.remove("open");
  sidebarOpenBtn.style.display = "flex";
  setTimeout(() => {
    sidebarOpenBtn.style.opacity = "1";
    sidebarOpenBtn.style.pointerEvents = "auto";
  }, 50);
};

if (sidebarToggle) {
  sidebarToggle.addEventListener("click", closeSidebar);
}

if (sidebarOpenBtn) {
  sidebarOpenBtn.addEventListener("click", openSidebar);
}

document.addEventListener("click", (e) => {
  if (!sidebar.contains(e.target) && !sidebarOpenBtn.contains(e.target)) {
    if (sidebar.classList.contains("open")) {
      closeSidebar();
    }
  }
});

function handleResponsive() {
  if (window.innerWidth <= 1024) {
    closeSidebar();
  }
}

window.addEventListener("resize", handleResponsive);
handleResponsive();

function createSidebarNavigation() {
  const currentName = window.getCurrentName
    ? window.getCurrentName()
    : "oliver";
  const basePath = window.getBasePath ? window.getBasePath() : "";
  const navigationSidebar = document.getElementById("navigationSidebar");
  const availableNames = window.availableNames || [
    "oliver",
    "alan",
    "sebastian",
    "hernando",
  ];

  if (availableNames.includes(currentName)) {
    availableNames.forEach((name, index) => {
      const link = document.createElement("a");
      link.className =
        name === currentName ? "sidebar-link active" : "sidebar-link";

      const colors = ["#0ea5e9", "#06b6d4", "#10b981", "#f59e0b"];
      const color = colors[index % colors.length];

      link.innerHTML = `
        <span class="link-icon" style="background: ${color}15; color: ${color};">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        </span>
        ${name.charAt(0).toUpperCase() + name.slice(1)}
      `;

      if (name !== currentName) {
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

      link.style.opacity = "0";
      link.style.transform = "translateX(-20px)";
      setTimeout(() => {
        link.style.transition = "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)";
        link.style.opacity = "1";
        link.style.transform = "translateX(0)";
      }, 100 + index * 50);

      navigationSidebar.appendChild(link);
    });
  } else {
    navigationSidebar.style.display = "none";
  }
}

// ==================== INFO MODAL CONTROLLER ====================
const infoBtn = document.getElementById("infoBtn");
const infoModal = document.getElementById("infoModal");
const closeModal = document.getElementById("closeModal");

if (infoBtn) {
  infoBtn.addEventListener("click", () => {
    infoModal.classList.add("active");
    updateModalInfo();
    closeModal.focus();
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
      closeSidebar();
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
