// sidebar.js - Lógica para el modal de navegación (COMPATIBLE)

// ==================== MODAL DE NAVEGACIÓN ====================
const navModal = document.getElementById('navModal');
const navModalBtn = document.getElementById('navModalBtn');
const closeNavModal = document.getElementById('closeNavModal');

// Abrir modal de navegación
if (navModalBtn) {
    navModalBtn.addEventListener('click', () => {
        navModal.classList.add('active');
        createModalNavigation();
    });
}

// Cerrar modal de navegación con el botón X
if (closeNavModal) {
    closeNavModal.addEventListener('click', () => {
        navModal.classList.remove('active');
    });
}

// Cerrar modal de navegación al hacer click fuera
if (navModal) {
    navModal.addEventListener('click', (e) => {
        if (e.target === navModal) {
            navModal.classList.remove('active');
        }
    });
}

// Cerrar modal de navegación con tecla ESC
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navModal.classList.contains('active')) {
        navModal.classList.remove('active');
    }
});

// ==================== CREAR NAVEGACIÓN EN MODAL ====================
function createModalNavigation() {
    // Usar las funciones de navigation.js que están disponibles globalmente
    const currentName = window.getCurrentName ? window.getCurrentName() : 'oliver';
    const basePath = window.getBasePath ? window.getBasePath() : '';
    const availableNames = window.availableNames || ['oliver', 'alan', 'sebastian', 'hernando'];
    
    const modalNavigation = document.getElementById('modalNavigation');
    
    if (!modalNavigation) return;
    
    // Limpiar navegación existente
    modalNavigation.innerHTML = '';
    
    if (availableNames.includes(currentName)) {
        availableNames.forEach((name) => {
            const link = document.createElement('a');
            link.className = name === currentName ? 'nav-modal-link active' : 'nav-modal-link';
            
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
                link.onclick = (e) => e.preventDefault();
            }
            
            modalNavigation.appendChild(link);
        });
    } else {
        modalNavigation.innerHTML = '<p style="padding: 1rem; text-align: center; color: #666;">Navegación no disponible</p>';
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

// Cerrar modal de información con el botón X
if (closeModal) {
    closeModal.addEventListener('click', () => {
        infoModal.classList.remove('active');
    });
}

// Cerrar modal de información al hacer click fuera
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
    // La navegación se crea cuando se abre el modal, no al cargar la página
});