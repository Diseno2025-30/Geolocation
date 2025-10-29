// static/js/sidebar.js
// Lógica del sidebar y modal de información

document.addEventListener('DOMContentLoaded', () => {
    
    // ==================== SIDEBAR ====================
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const sidebarOpenBtn = document.getElementById('sidebarOpenBtn');

    if (sidebarToggle) {
        sidebarToggle.addEventListener('click', () => sidebar.classList.remove('open'));
    }
    if (sidebarOpenBtn) {
        sidebarOpenBtn.addEventListener('click', () => sidebar.classList.add('open'));
    }

    // Cerrar al hacer click fuera (en el overlay)
    document.addEventListener('click', (e) => {
        if (!sidebar.contains(e.target) && !sidebarOpenBtn.contains(e.target)) {
            sidebar.classList.remove('open');
        }
    });

    // ==================== MODAL INFO ====================
    const infoBtn = document.getElementById('infoBtn');
    const infoModal = document.getElementById('infoModal');
    const closeModal = document.getElementById('closeModal');

    const toggleModal = (active) => {
        if (active) {
            updateModalInfo();
            infoModal.classList.add('active');
        } else {
            infoModal.classList.remove('active');
        }
    };

    if (infoBtn) infoBtn.addEventListener('click', () => toggleModal(true));
    if (closeModal) closeModal.addEventListener('click', () => toggleModal(false));
    if (infoModal) {
        infoModal.addEventListener('click', (e) => {
            if (e.target === infoModal) toggleModal(false);
        });
    }

    // ==================== CERRAR CON ESC ====================
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (infoModal && infoModal.classList.contains('active')) {
                toggleModal(false);
            }
            if (sidebar && sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
            }
        }
    });
});

// ==================== ACTUALIZAR INFO ====================
// Esta función es llamada por sidebar.js y por los scripts de la página
window.updateModalInfo = function() {
    const mappings = {
        '#lastQuery': '#modalLastQuery',
        '#puntosHistoricos': '#modalPuntos',
        '#rangoConsultado': '#modalRango',
        '#diasIncluidos': '#modalDias',
        '#status': '#modalStatus',
        '#lastUpdate': '#modalLastUpdate',
        '#puntosTrayectoria': '#modalPuntos'
    };

    for (const [sourceId, targetId] of Object.entries(mappings)) {
        const sourceEl = document.querySelector(sourceId);
        const targetEl = document.querySelector(targetId);
        if (sourceEl && targetEl) {
            targetEl.textContent = sourceEl.textContent;
            // Manejar clases de status
            if (sourceId === '#status') {
                targetEl.className = 'modal-value';
                if (sourceEl.textContent === 'ONLINE') targetEl.classList.add('online');
                else targetEl.classList.add('offline');
            }
        }
    }
}