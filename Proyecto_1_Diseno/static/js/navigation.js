// navigation.js - Lógica compartida de navegación

const availableNames = ['oliver', 'alan', 'sebastian', 'hernando'];

function getBasePath() {
    // Detectar si estamos en modo test o producción
    return window.BASE_PATH || '';
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

function isHistoricalView() {
    return window.location.pathname.includes('/historics');
}

// Función para configurar la navegación entre vistas (Real-Time ↔ Historical)
function setupViewNavigation() {
    const basePath = getBasePath();
    const isHistorical = isHistoricalView();
    
    // Configurar el enlace de Real-Time
    const realtimeLink = document.getElementById('realtimeLink');
    if (realtimeLink) {
        realtimeLink.href = basePath ? `${basePath}/` : '/';
        realtimeLink.onclick = null; // Permitir navegación normal
    }
    
    // Configurar el enlace de Historical
    const historicalLink = document.getElementById('historicalLink');
    if (historicalLink) {
        historicalLink.href = basePath ? `${basePath}/historics/` : '/historics/';
        historicalLink.onclick = null; // Permitir navegación normal
    }
}

// Función para crear navegación en el modal (si existe)
function createModalNavigation() {
    const modalNavigation = document.getElementById('modalNavigation');
    
    if (!modalNavigation) {
        return;
    }
    
    const currentName = getCurrentName();
    const basePath = getBasePath();
    
    modalNavigation.innerHTML = '';
    
    if (availableNames.includes(currentName)) {
        availableNames.forEach((name) => {
            const link = document.createElement('a');
            link.className = name === currentName ? 'nav-modal-link active' : 'nav-modal-link';
            
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
                const currentPath = isHistoricalView() ? '/historics/' : '/';
                if (basePath === '/test') {
                    link.href = `https://${name}.tumaquinaya.com${basePath}${currentPath}`;
                } else {
                    link.href = `https://${name}.tumaquinaya.com${currentPath}`;
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

// Inicializar navegación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    setupViewNavigation();
    createModalNavigation();
});

// Exponer funciones para que otros scripts las usen
window.getBasePath = getBasePath;
window.getCurrentName = getCurrentName;
window.setupViewNavigation = setupViewNavigation;
window.createModalNavigation = createModalNavigation;
window.availableNames = availableNames;
window.isHistoricalView = isHistoricalView;