// sidebar.js - Lógica del sidebar y modal de información

// ==================== CONFIGURACIÓN COMPARTIDA ====================
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

// ==================== SIDEBAR FUNCTIONALITY ====================
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
const mainContent = document.getElementById('mainContent');

// Abrir sidebar (funciona en todas las resoluciones)
if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        // El CSS se encarga de ocultar el botón cuando el sidebar está abierto
    });
}

// Cerrar sidebar con el botón toggle
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.remove('open');
        // El CSS se encarga de mostrar el botón cuando el sidebar está cerrado
    });
}

// Cerrar sidebar al hacer click fuera (funciona en todas las resoluciones)
document.addEventListener('click', (e) => {
    // Verificar si el click fue fuera del sidebar y del botón de abrir
    const isClickInsideSidebar = sidebar.contains(e.target);
    const isClickOnOpenBtn = sidebarOpenBtn && sidebarOpenBtn.contains(e.target);
    
    if (!isClickInsideSidebar && !isClickOnOpenBtn) {
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
        }
    }
});

// Cerrar sidebar con tecla ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
    }
});

// ==================== CREAR NAVEGACIÓN EN SIDEBAR ====================
function createSidebarNavigation() {
    const currentName = getCurrentName();
    const basePath = getBasePath();
    const navigationSidebar = document.getElementById('navigationSidebar');
    
    if (!navigationSidebar) return;
    
    if (availableNames.includes(currentName)) {
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
            }
            
            navigationSidebar.appendChild(link);
        });
    } else {
        navigationSidebar.style.display = 'none';
    }
}

// ==================== MODAL DE INFORMACIÓN ====================
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModal = document.getElementById('closeModal');

// Abrir modal
if (infoBtn) {
    infoBtn.addEventListener('click', () => {
        infoModal.classList.add('active');
        updateModalInfo();
    });
}

// Cerrar modal con el botón X
if (closeModal) {
    closeModal.addEventListener('click', () => {
        infoModal.classList.remove('active');
    });
}

// Cerrar modal al hacer click fuera
if (infoModal) {
    infoModal.addEventListener('click', (e) => {
        if (e.target === infoModal) {
            infoModal.classList.remove('active');
        }
    });
}

// Cerrar modal con tecla ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && infoModal.classList.contains('active')) {
        infoModal.classList.remove('active');
    }
});

// ==================== ACTUALIZAR INFO DEL MODAL ====================
function updateModalInfo() {
    // Obtener valores de los elementos ocultos (si existen)
    const lastQuery = document.getElementById('lastQuery');
    const puntosHistoricos = document.getElementById('puntosHistoricos');
    const rangoConsultado = document.getElementById('rangoConsultado');
    const diasIncluidos = document.getElementById('diasIncluidos');
    
    // Actualizar valores en el modal
    if (lastQuery) {
        document.getElementById('modalLastQuery').textContent = lastQuery.textContent;
    }
    if (puntosHistoricos) {
        document.getElementById('modalPuntos').textContent = puntosHistoricos.textContent;
    }
    if (rangoConsultado) {
        document.getElementById('modalRango').textContent = rangoConsultado.textContent;
    }
    if (diasIncluidos) {
        document.getElementById('modalDias').textContent = diasIncluidos.textContent;
    }
}

// Exponer función para que historical.js pueda actualizar el modal
window.updateModalInfo = updateModalInfo;

// ==================== INICIALIZAR ====================
document.addEventListener('DOMContentLoaded', () => {
    createSidebarNavigation();
    setupViewNavigation(true); // Para vista histórica
});