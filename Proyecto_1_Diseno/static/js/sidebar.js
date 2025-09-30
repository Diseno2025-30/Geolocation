// sidebar.js - Lógica del modal de navegación y modal de información

// ==================== MODAL DE NAVEGACIÓN ====================
const navModal = document.getElementById('navModal');
const navModalClose = document.getElementById('navModalClose');
const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');

// Abrir modal de navegación desde el botón hamburguesa
if (sidebarOpenBtn) {
    sidebarOpenBtn.addEventListener('click', () => {
        navModal.classList.add('active');
    });
}

// Cerrar modal con el botón X
if (navModalClose) {
    navModalClose.addEventListener('click', () => {
        navModal.classList.remove('active');
    });
}

// Cerrar modal al hacer click en el fondo oscuro
if (navModal) {
    navModal.addEventListener('click', (e) => {
        if (e.target === navModal) {
            navModal.classList.remove('active');
        }
    });
}

// Cerrar modal con tecla ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navModal.classList.contains('active')) {
        navModal.classList.remove('active');
    }
});

// ==================== CREAR NAVEGACIÓN EN MODAL ====================
function createModalNavigation() {
    const currentName = getCurrentName();
    const basePath = getBasePath();
    const navigationContainer = document.getElementById('navigationModal');
    
    if (availableNames.includes(currentName)) {
        availableNames.forEach((name) => {
            const link = document.createElement('a');
            link.className = name === currentName ? 'nav-link active' : 'nav-link';
            
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
                link.style.cursor = 'default';
            }
            
            navigationContainer.appendChild(link);
        });
    } else {
        navigationContainer.parentElement.style.display = 'none';
    }
}

// ==================== MODAL DE INFORMACIÓN ====================
const infoBtn = document.getElementById('infoBtn');
const infoModal = document.getElementById('infoModal');
const closeModal = document.getElementById('closeModal');

// Abrir modal de información
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

// Cerrar modal de información con tecla ESC
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
    if (lastQuery && document.getElementById('modalLastQuery')) {
        document.getElementById('modalLastQuery').textContent = lastQuery.textContent;
    }
    if (puntosHistoricos && document.getElementById('modalPuntos')) {
        document.getElementById('modalPuntos').textContent = puntosHistoricos.textContent;
    }
    if (rangoConsultado && document.getElementById('modalRango')) {
        document.getElementById('modalRango').textContent = rangoConsultado.textContent;
    }
    if (diasIncluidos && document.getElementById('modalDias')) {
        document.getElementById('modalDias').textContent = diasIncluidos.textContent;
    }
}

// Exponer función para que historical.js pueda actualizar el modal
window.updateModalInfo = updateModalInfo;

// ==================== INICIALIZAR ====================
document.addEventListener('DOMContentLoaded', () => {
    createModalNavigation();
});