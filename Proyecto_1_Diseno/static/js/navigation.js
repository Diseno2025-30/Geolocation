// navigation.js - Lógica compartida de navegación (ACTUALIZADO para modales)

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

// Función para crear navegación en el modal (reemplaza createNavigationTabs)
function createModalNavigation() {
    const modalNavigation = document.getElementById('modalNavigation');
    
    // Solo ejecutar si el elemento existe en el modal
    if (!modalNavigation) {
        return;
    }
    
    const currentName = getCurrentName();
    const basePath = getBasePath();
    
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

// Función actualizada para navegación entre vistas (ahora en el modal)
function setupViewNavigation(isHistoricalView = false) {
    // La navegación entre vistas ahora se maneja en el HTML del modal
    // Esta función se mantiene por compatibilidad pero puede estar vacía
    // o usarse para lógica adicional si es necesario
}

// Ya no necesitamos crear tabs al cargar la página
// document.addEventListener('DOMContentLoaded', createNavigationTabs);

// Exponer funciones para que otros scripts las usen
window.getBasePath = getBasePath;
window.getCurrentName = getCurrentName;
window.setupViewNavigation = setupViewNavigation;
window.createModalNavigation = createModalNavigation;
window.availableNames = availableNames;