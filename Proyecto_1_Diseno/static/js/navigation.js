// static/js/navigation.js
// Lógica compartida de navegación

const availableNames = ['oliver', 'alan', 'sebastian', 'hernando'];

function getBasePath() {
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

function setupViewNavigation() {
    const basePath = getBasePath();
    
    const realtimeLink = document.getElementById('realtimeLink');
    if (realtimeLink) {
        realtimeLink.href = basePath ? `${basePath}/` : '/';
    }
    
    const historicalLink = document.getElementById('historicalLink');
    if (historicalLink) {
        historicalLink.href = basePath ? `${basePath}/historics/` : '/historics/';
    }
}

function createSidebarNavigation() {
    const navigationSidebar = document.getElementById('navigationSidebar');
    if (!navigationSidebar) return;

    const currentName = getCurrentName();
    const basePath = getBasePath();
    const isHistorical = isHistoricalView();
    
    availableNames.forEach((name) => {
        const link = document.createElement('a');
        link.className = name === currentName ? 'sidebar-link active' : 'sidebar-link';
        
        const emoji = {'oliver': '🖥️', 'alan': '🖥️', 'sebastian': '🖥️', 'hernando': '🖥️'};
        
        link.innerHTML = `
            <span class="link-icon">${emoji[name] || '📌'}</span>
            ${name.charAt(0).toUpperCase() + name.slice(1)}
        `;
        
        if (name !== currentName) {
            const path = isHistorical ? '/historics/' : '/';
            link.href = `https://${name}.tumaquinaya.com${basePath}${path}`;
            link.target = '_self';
        }
        
        navigationSidebar.appendChild(link);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupViewNavigation();
    createSidebarNavigation();
});

// Exponer funciones globales
window.getBasePath = getBasePath;
window.getCurrentName = getCurrentName;
window.isHistoricalView = isHistoricalView;
window.availableNames = availableNames;