// sidebar.js - Lógica del sidebar y modal de información
// Versión unificada: sidebar oculto por defecto y desplegable en todas las resoluciones.
// Mantengo el modal EXACTAMENTE como lo tenías y `createSidebarNavigation()`.

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

/* ==================== CREAR NAVEGACIÓN EN SIDEBAR ==================== */
function createSidebarNavigation() {
    const currentName = getCurrentName();
    const basePath = getBasePath();
    const navigationSidebar = document.getElementById('navigationSidebar');

    if (!navigationSidebar) return;

    if (availableNames.includes(currentName)) {
        // limpiar contenido previo (si hay)
        navigationSidebar.innerHTML = '<h4>Rastreadores</h4>';

        availableNames.forEach((name) => {
            const link = document.createElement('a');
            link.className = name === currentName ? 'sidebar-link active' : 'sidebar-link';

            // Emoji según el nombre
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
                // si es el actual evitamos enlace (o lo dejamos como botón)
                link.removeAttribute('href');
            }

            navigationSidebar.appendChild(link);
        });
    } else {
        navigationSidebar.style.display = 'none';
    }
}

/* ==================== MODAL DE INFORMACIÓN ==================== */
/* Mantengo exactamente tus handlers y la función de actualización */
function updateModalInfo() {
    // Obtener valores de los elementos ocultos (si existen)
    const lastQuery = document.getElementById('lastQuery');
    const puntosHistoricos = document.getElementById('puntosHistoricos');
    const rangoConsultado = document.getElementById('rangoConsultado');
    const diasIncluidos = document.getElementById('diasIncluidos');

    // Actualizar valores en el modal
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

// Exponer la función para que otros scripts (historical.js) puedan actualizar el modal
window.updateModalInfo = updateModalInfo;

/* ==================== SIDEBAR FUNCTIONALITY (UNIFICADA) ==================== */
document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle'); // botón interno (◀)
    const sidebarOpenBtn = document.getElementById('sidebarOpenBtn'); // botón flotante ☰

    // Modal elements (se mantienen y se inicializan aquí)
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.getElementById('closeModal');

    // Safety: si algún elemento no existe, nos salimos de forma segura
    if (!sidebar) {
        // nada que hacer si no existe el sidebar en la página
        createSidebarNavigation(); // aún intentamos crear nav (no fallará si no hay)
        return;
    }

    // 1) Mostrar el botón abrir (por si hay estilos que lo ocultan)
    if (sidebarOpenBtn) {
        sidebarOpenBtn.style.display = 'block';
        sidebarOpenBtn.setAttribute('aria-expanded', 'false');
    }

    // Funciones de apertura / cierre (centradas para evitar duplicación)
    function openSidebar() {
        sidebar.classList.add('open');
        if (sidebarOpenBtn) {
            sidebarOpenBtn.style.display = 'none';
            sidebarOpenBtn.setAttribute('aria-expanded', 'true');
        }
        // opcional: focus dentro del sidebar si requieres accesibilidad
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        if (sidebarOpenBtn) {
            sidebarOpenBtn.style.display = 'block';
            sidebarOpenBtn.setAttribute('aria-expanded', 'false');
        }
    }

    // 2) Abrir con botón flotante
    if (sidebarOpenBtn) {
        sidebarOpenBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSidebar();
        });
    }

    // 3) Cerrar con el botón interno (sidebarToggle)
    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            closeSidebar();
        });
    }

    // 4) Cerrar al hacer clic fuera (funciona en todas las resoluciones)
    document.addEventListener('click', (e) => {
        // Si sidebar está abierto y el clic no fue dentro del sidebar ni sobre el boton abrir -> cerrar
        if (sidebar.classList.contains('open')) {
            const clickedInsideSidebar = sidebar.contains(e.target);
            const clickedOpenBtn = sidebarOpenBtn && sidebarOpenBtn.contains(e.target);
            if (!clickedInsideSidebar && !clickedOpenBtn) {
                closeSidebar();
            }
        }
    });

    // 5) Evitar que clicks dentro del sidebar "burdeen" el handler del documento (opcional safe)
    sidebar.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    /* ==================== MODAL: mantener exactamente tu comportamiento ==================== */
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

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Cerrar modal si está abierto (igual que antes)
            if (infoModal && infoModal.classList.contains('active')) {
                infoModal.classList.remove('active');
            }
            // *no* cerramos sidebar con ESC para no cambiar tu comportamiento actual
        }
    });

    /* ==================== INICIALIZAR NAVEGACIÓN ==================== */
    createSidebarNavigation();
});
