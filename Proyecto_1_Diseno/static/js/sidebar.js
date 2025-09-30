// sidebar.js - Lógica del sidebar y modal de información

// ==================== SIDEBAR FUNCTIONALITY ====================
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
const mainContent = document.getElementById('mainContent');

// Toggle sidebar desde el botón interno ◀ (colapsar)
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
        mainContent.classList.toggle('expanded');
    });
}

// Abrir sidebar desde el botón flotante hamburguesa
if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener('click', () => {
        sidebar.classList.remove('collapsed');
        mainContent.classList.remove('expanded');
    });
}

// ==================== CREAR NAVEGACIÓN EN SIDEBAR ====================
function createSidebarNavigation() {
    const currentName = getCurrentName();
    const basePath = getBasePath();
    const navigationSidebar = document.getElementById('navigationSidebar');
    
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
});