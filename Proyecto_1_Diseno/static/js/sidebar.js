// sidebar.js - Lógica del sidebar y modal de información
// Usa las funciones y variables de navigation.js (ya cargado antes)

// ==================== SIDEBAR FUNCTIONALITY ====================
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');
const mainContent = document.getElementById('mainContent');

// Toggle sidebar - CERRAR cuando está abierto
if (sidebarToggle) {
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.remove('open');
        sidebarOpenBtn.style.display = 'flex';
    });
}

// Abrir sidebar
if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener('click', () => {
        sidebar.classList.add('open');
        sidebarOpenBtn.style.display = 'none';
    });
}

// Cerrar sidebar al hacer click fuera
document.addEventListener('click', (e) => {
    if (!sidebar.contains(e.target) && !sidebarOpenBtn.contains(e.target)) {
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            sidebarOpenBtn.style.display = 'flex';
        }
    }
});

// Responsive: ajustar comportamiento según tamaño de pantalla
function handleResponsive() {
    if (window.innerWidth <= 768) {
        // En móvil, asegurar que el sidebar esté cerrado por defecto
        sidebar.classList.remove('open');
        sidebarOpenBtn.style.display = 'flex';
    } else {
        // En desktop, cerrar el sidebar también
        sidebar.classList.remove('open');
        sidebarOpenBtn.style.display = 'flex';
    }
}

window.addEventListener('resize', handleResponsive);
handleResponsive();

// ==================== CREAR NAVEGACIÓN EN SIDEBAR ====================
function createSidebarNavigation() {
    const currentName = getCurrentName(); // Usa la función de navigation.js
    const basePath = getBasePath(); // Usa la función de navigation.js
    const navigationSidebar = document.getElementById('navigationSidebar');
    
    if (availableNames.includes(currentName)) { // Usa la variable de navigation.js
        availableNames.forEach((name) => {
            const link = document.createElement('a');
            link.className = name === currentName ? 'sidebar-link active' : 'sidebar-link';
            
            // Emoji según el nombre
            const emoji = {
                'oliver': '🖥️',
                'alan': '🖥️',
                'sebastian': '🖥️',
                'hernando': '🖥️'
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
    if (e.key === 'Escape') {
        if (infoModal.classList.contains('active')) {
            infoModal.classList.remove('active');
        }
        // También cerrar sidebar con ESC
        if (sidebar.classList.contains('open')) {
            sidebar.classList.remove('open');
            sidebarOpenBtn.style.display = 'flex';
        }
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
        const modalLastQuery = document.getElementById('modalLastQuery');
        if (modalLastQuery) modalLastQuery.textContent = lastQuery.textContent;
    }
    if (puntosHistoricos) {
        const modalPuntos = document.getElementById('modalPuntos');
        if (modalPuntos) modalPuntos.textContent = puntosHistoricos.textContent;
    }
    if (rangoConsultado) {
        const modalRango = document.getElementById('modalRango');
        if (modalRango) modalRango.textContent = rangoConsultado.textContent;
    }
    if (diasIncluidos) {
        const modalDias = document.getElementById('modalDias');
        if (modalDias) modalDias.textContent = diasIncluidos.textContent;
    }
}

// Exponer función para que historical.js pueda actualizar el modal
window.updateModalInfo = updateModalInfo;

// ==================== INICIALIZAR ====================
document.addEventListener('DOMContentLoaded', () => {
    createSidebarNavigation();
});