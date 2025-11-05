export function obtenerFechaHoraColombia() {
    const ahoraUTC = new Date();
    const offsetColombia = -5 * 60 * 60 * 1000;
    return new Date(ahoraUTC.getTime() + offsetColombia);
}

export function obtenerFechaActual() {
    const ahoraColombia = obtenerFechaHoraColombia();
    const año = ahoraColombia.getUTCFullYear();
    const mes = String(ahoraColombia.getUTCMonth() + 1).padStart(2, '0');
    const dia = String(ahoraColombia.getUTCDate()).padStart(2, '0');
    return `${año}-${mes}-${dia}`;
}

export function obtenerHoraActual() {
    const ahoraColombia = obtenerFechaHoraColombia();
    const horas = String(ahoraColombia.getUTCHours()).padStart(2, '0');
    const minutos = String(ahoraColombia.getUTCMinutes()).padStart(2, '0');
    return `${horas}:${minutos}`;
}

export function parseTimestamp(timestamp) {
    const [datePart, timePart] = timestamp.split(' ');
    if (!datePart || !timePart) {
        console.error('Timestamp inválido:', timestamp);
        return new Date();
    }
    const [day, month, year] = datePart.split('/');
    return new Date(`${year}-${month}-${day}T${timePart}`);
}

export function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

export function formatDuration(durationMs) {
    if (isNaN(durationMs) || durationMs < 0) return "---";

    const dias = Math.floor(durationMs / (1000 * 60 * 60 * 24));
    const horas = Math.floor((durationMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutos = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));

    let parts = [];
    if (dias > 0) parts.push(`${dias} ${dias === 1 ? 'día' : 'días'}`);
    if (horas > 0) parts.push(`${horas} ${horas === 1 ? 'hora' : 'horas'}`);
    if (minutos > 0 || (dias === 0 && horas === 0)) {
        parts.push(`${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}`);
    }

    if (parts.length === 0) return "0 minutos";
    return parts.join(' ');
}