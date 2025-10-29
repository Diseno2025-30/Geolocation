// app/static/js/modules/ui.js

/** Actualiza el contenido de texto de un elemento */
export function updateText(selector, text) {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
}

/** Actualiza un campo de valor (label + value) */
export function updateField(id, value) {
    updateText(`#${id}`, value);
}

/** Muestra u oculta un elemento */
export function setVisible(selector, visible) {
    const el = document.querySelector(selector);
    if (el) {
        el.style.display = visible ? '' : 'none';
    }
}

/** Alterna una clase en un elemento */
export function toggleClass(selector, className, force) {
     const el = document.querySelector(selector);
    if (el) el.classList.toggle(className, force);
}

/** Actualiza la barra de progreso */
export function updateProgress(barSelector, textSelector, current, total) {
    const percentage = total > 0 ? (current / total) * 100 : 0;
    const bar = document.querySelector(barSelector);
    if (bar) bar.style.width = `${percentage}%`;
    updateText(textSelector, `${current} / ${total} segmentos`);
}

/** Obtiene el valor de un input */
export function getValue(selector) {
    const el = document.querySelector(selector);
    return el ? el.value : '';
}

/** Establece el valor de un input */
export function setValue(selector, value) {
    const el = document.querySelector(selector);
    if (el) el.value = value;
}

/** Formatea una fecha a YYYY-MM-DD */
export function formatDate(date) {
    return date.toISOString().split('T')[0];
}

/** Actualiza el modal de info llamando a la función global */
export function updateInfoModal() {
    if (window.updateModalInfo) {
        window.updateModalInfo();
    }
}