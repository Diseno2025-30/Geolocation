// navigation.js - Lógica compartida de navegación

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

function createNavigationTabs() {
    const navigationContainer = document.getElementById('navigationTabs');
    
    // Solo ejecutar si el elemento existe (para compatibilidad con vistas antiguas)
    if (!navigationContainer) {
        return;
    }
    
    const currentName = getCurrentName();
    const basePath = getBasePath();
    
    if (availableNames.includes(currentName)) {
        navigationContainer.style.display = 'flex';
        
        navigationContainer.innerHTML = '<strong>Otros rastreadores disponibles:</strong>';
        
        availableNames.forEach((name) => {
            const tab = document.createElement('a');
            tab.className = name === currentName ? 'nav-tab current' : 'nav-tab';
            tab.textContent = name.charAt(0).toUpperCase() + name.slice(1);
            
            if (name === currentName) {
                tab.style.cursor = 'default';
                tab.removeAttribute('href');
            } else {
                if (basePath === '/test') {
                    tab.href = `https://${name}.tumaquinaya.com${basePath}${window.location.pathname.includes('historics') ? '/historics/' : '/'}`;
                } else {
                    tab.href = `https://${name}.tumaquinaya.com${window.location.pathname.includes('historics') ? '/historics/' : '/'}`;
                }
                tab.target = '_self';
            }
            
            navigationContainer.appendChild(tab);
        });
    }
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

document.addEventListener('DOMContentLoaded', createNavigationTabs);