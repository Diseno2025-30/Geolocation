// navigation.js - Lógica compartida de navegación (compatible con modal)

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

// Esta función ya NO se usa en el nuevo sistema de modal
// Se mantiene vacía para evitar errores si algún código antiguo la llama
function createNavigationTabs() {
    // No hace nada - la navegación ahora la maneja sidebar.js con createModalNavigation()
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

// NO llamar createNavigationTabs en DOMContentLoaded
// La navegación ahora la maneja sidebar.js