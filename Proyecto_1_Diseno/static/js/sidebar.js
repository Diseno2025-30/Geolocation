// sidebar.js - Navegación (modal) + Información
// Versión limpia: sin duplicados, sin referencias a #navigationTabs.

/* ==================== CONFIGURACIÓN COMPARTIDA ==================== */
const availableNames = ['oliver', 'alan', 'sebastian', 'hernando'];

function getBasePath() {
    return window.location.pathname.includes('/test/') ? '/test' : '';
}

function getCurrentName() {
    const hostname = window.location.hostname;
    const subdomain = hostname.split('.')[0];

    if (availableNames.includes(subdomain.toLowerCase())) {
        return subdomain.toLowerCase();
    }

    const title = document.title.toLowerCase();
    for (const name of availableNames) {
        if (title.includes(name)) {
            return name;
        }
    }

    return 'oliver';
}

function setupViewNavigation(isHistoricalView = false) {
    const basePath = getBasePath();

    if (isHistoricalView) {
        const realtimeLink = document.getElementById('realtimeLink');
        if (realtimeLink) {
            realtimeLink.href = basePath === '/test' ? `${basePath}/` : '/';
        }
    } else {
        const historicalLink = document.getElementById('historicalLink');
        if (historicalLink) {
            historicalLink.href = basePath === '/test' ? `${basePath}/historics/` : '/historics/';
        }
    }
}

/* ==================== CREAR NAVEGACIÓN EN MODAL ==================== */
function createSidebarNavigation() {
    const currentName = getCurrentName();
    const basePath = getBasePath();
    const navigationSidebar = document.getElementById('navigationSidebar');

    if (!navigationSidebar) return;

    if (availableNames.includes(currentName)) {
        navigationSidebar.innerHTML = '<h4>Rastreadores</h4>';

        availableNames.forEach((name) => {
            const link = document.createElement('a');
            link.className = name === currentName ? 'sidebar-link active' : 'sidebar-link';

            const emoji = {
                'oliver': '🐶',
                'alan': '🚗',
                'sebastian': '📍',
                'hernando': '🗺️'
            };

            link.innerHTML = `
                <span class="link-icon">${emoji[name] || '📌'}</span>
                ${name.charAt(0).toUpperCase() + name.slice(1)}
            `;

            if (name !== currentName) {
                if (basePath === '/test') {
                    link.href = `https://${name}.tumaquinaya.com${basePath}${window.location.pathname.includes('historics') ? '/historics/' : '/'}`;
                } else {
                    link.href = `https://${name}.tumaquinaya.com${window.location.pathname.includes('historics') ? '/historics/' : '/'}`;
                }
                link.target = '_self';
            } else {
                link.removeAttribute('href');
            }

            navigationSidebar.appendChild(link);
        });
    } else {
        navigationSidebar.style.display = 'none';
    }
}

/* ==================== MODAL DE INFORMACIÓN ==================== */
function updateModalInfo() {
    const lastQuery = document.getElementById('lastQuery');
    const puntosHistoricos = document.getElementById('puntosHistoricos');
    const rangoConsultado = document.getElementById('rangoConsultado');
    const diasIncluidos = document.getElementById('diasIncluidos');

    if (lastQuery) {
        const el = document.getElementById('modalLastQuery');
        if (el) el.textContent = lastQuery.textContent;
    }
    if (puntosHistoricos) {
        const el = document.getElementById('modalPuntos');
        if (el) el.textContent = puntosHistoricos.textContent;
    }
    if (rangoConsultado) {
        const el = document.getElementById('modalRango');
        if (el) el.textContent = rangoConsultado.textContent;
    }
    if (diasIncluidos) {
        const el = document.getElementById('modalDias');
        if (el) el.textContent = diasIncluidos.textContent;
    }
}

window.updateModalInfo = updateModalInfo;

/* ==================== MANEJO DE MODALES (NAVEGACIÓN + INFO) ==================== */
document.addEventListener('DOMContentLoaded', () => {
    // --- Modal de navegación ---
    const navBtn = document.getElementById('navBtn');
    const navModal = document.getElementById('navModal');
    const closeNavModal = document.getElementById('closeNavModal');

    if (navBtn && navModal) {
        navBtn.addEventListener('click', () => {
            navModal.classList.add('active');
        });
    }

    if (closeNavModal) {
        closeNavModal.addEventListener('click', () => {
            navModal.classList.remove('active');
        });
    }

    if (navModal) {
        navModal.addEventListener('click', (e) => {
            if (e.target === navModal) {
                navModal.classList.remove('active');
            }
        });
    }

    // --- Modal de información ---
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.getElementById('closeModal');

    if (infoBtn && infoModal) {
        infoBtn.addEventListener('click', () => {
            infoModal.classList.add('active');
            updateModalInfo();
        });
    }

    if (closeModal) {
        closeModal.addEventListener('click', () => {
            infoModal.classList.remove('active');
        });
    }

    if (infoModal) {
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) {
                infoModal.classList.remove('active');
            }
        });
    }

    // Escape cierra solo los modales
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (navModal && navModal.classList.contains('active')) {
                navModal.classList.remove('active');
            }
            if (infoModal && infoModal.classList.contains('active')) {
                infoModal.classList.remove('active');
            }
        }
    });

    // Inicializar navegación dinámica
    createSidebarNavigation();
});
