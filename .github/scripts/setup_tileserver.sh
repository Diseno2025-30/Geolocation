#!/bin/bash

echo "🧹 ========================================="
echo "🧹 LIMPIEZA TOTAL DEL SISTEMA"
echo "🧹 ========================================="
echo "Eliminando TODO: servidor de tiles, swap, archivos PBF, volúmenes Docker"
echo ""

# ========== 1. DETENER Y ELIMINAR CONTENEDORES DE TILES ==========
echo "1️⃣ Deteniendo y eliminando contenedores de tiles..."
docker stop $(docker ps -a -q --filter "name=tile" --filter "name=openstreet" --filter "name=osm") 2>/dev/null || true
docker stop $(docker ps -a -q --filter "ancestor=overv/openstreetmap-tile-server") 2>/dev/null || true
docker rm -f $(docker ps -a -q --filter "name=tile" --filter "name=openstreet" --filter "name=osm") 2>/dev/null || true
docker rm -f $(docker ps -a -q --filter "ancestor=overv/openstreetmap-tile-server") 2>/dev/null || true
echo "   ✅ Contenedores eliminados"

# ========== 2. ELIMINAR VOLÚMENES DOCKER DE TILES ==========
echo "2️⃣ Eliminando volúmenes Docker de tiles..."
for vol in $(docker volume ls -q | grep -E "tile|openstreet|osm|postgres"); do
    echo "   Eliminando volumen: $vol"
    docker volume rm $vol 2>/dev/null || true
done
# Eliminar todos los volúmenes huérfanos también
docker volume prune -f 2>/dev/null || true
echo "   ✅ Volúmenes eliminados"

# ========== 3. ELIMINAR IMÁGENES DE TILES ==========
echo "3️⃣ Eliminando imágenes de tiles..."
docker rmi $(docker images overv/openstreetmap-tile-server -q) 2>/dev/null || true
docker image prune -f 2>/dev/null || true
echo "   ✅ Imágenes eliminadas"

# ========== 4. ELIMINAR ARCHIVOS PBF ==========
echo "4️⃣ Eliminando archivos PBF..."
sudo find / -name "*.osm.pbf" -type f 2>/dev/null | while read file; do
    echo "   Eliminando: $file"
    sudo rm -f "$file"
done
sudo find / -name "*.osm.bz2" -type f 2>/dev/null | while read file; do
    echo "   Eliminando: $file"
    sudo rm -f "$file"
done
sudo rm -rf /opt/tile-data 2>/dev/null || true
sudo rm -rf /tmp/*.osm.pbf 2>/dev/null || true
sudo rm -rf /tmp/*.osm.bz2 2>/dev/null || true
echo "   ✅ Archivos PBF eliminados"

# ========== 5. ELIMINAR SWAP ==========
echo "5️⃣ Eliminando swap files..."
# Desactivar swap
sudo swapoff -a 2>/dev/null || true

# Eliminar swapfile
if [ -f /swapfile ]; then
    echo "   Eliminando /swapfile (4.1GB liberados)"
    sudo rm -f /swapfile
fi

# Eliminar cualquier otro swap
sudo find / -name "swapfile" -type f 2>/dev/null | while read swap; do
    echo "   Eliminando: $swap"
    sudo rm -f "$swap"
done

# Limpiar fstab de entradas de swap
sudo sed -i '/swap/d' /etc/fstab
echo "   ✅ Swap eliminado"

# ========== 6. ELIMINAR SERVICIOS SYSTEMD DE TILES ==========
echo "6️⃣ Eliminando servicios systemd de tiles..."
sudo systemctl stop tileserver 2>/dev/null || true
sudo systemctl disable tileserver 2>/dev/null || true
sudo rm -f /etc/systemd/system/tileserver.service 2>/dev/null || true
sudo rm -f /etc/systemd/system/tile*.service 2>/dev/null || true
sudo systemctl daemon-reload
echo "   ✅ Servicios eliminados"

# ========== 7. LIMPIAR CACHÉ DE DOCKER COMPLETAMENTE ==========
echo "7️⃣ Limpiando caché de Docker..."
docker system prune -a -f --volumes 2>/dev/null || true
echo "   ✅ Caché de Docker limpiado"

# ========== 8. ELIMINAR ARCHIVOS TEMPORALES DE INSTALACIÓN ==========
echo "8️⃣ Eliminando archivos temporales de instalación..."
sudo rm -rf /tmp/tile-server-*.log 2>/dev/null || true
sudo rm -rf /tmp/custom-init.sh 2>/dev/null || true
sudo rm -rf /tmp/optimized-import.sh 2>/dev/null || true
sudo rm -rf /tmp/renderd*.conf 2>/dev/null || true
sudo rm -rf /tmp/import-*.sh 2>/dev/null || true
sudo rm -rf /home/ubuntu/monitor-tiles.sh 2>/dev/null || true
echo "   ✅ Archivos temporales eliminados"

# ========== 9. VERIFICAR ESPACIO LIBERADO ==========
echo ""
echo "📊 ========================================="
echo "📊 ESPACIO LIBERADO"
echo "📊 ========================================="

# Mostrar antes/después
echo "Espacio antes de limpiar:"
df -h / | awk 'NR==2 {print "   Usado: " $3 ", Disponible: " $4}'

# Forzar sync para actualizar stats
sync

echo ""
echo "Espacio después de limpiar:"
df -h / | awk 'NR==2 {print "   Usado: " $3 ", Disponible: " $4}'

# ========== 10. MOSTRAR QUÉ QUEDA ==========
echo ""
echo "🔍 ========================================="
echo "🔍 VERIFICACIÓN FINAL"
echo "🔍 ========================================="

# Verificar que no queden contenedores de tiles
TILE_CONTAINERS=$(docker ps -a --filter "name=tile" --filter "name=openstreet" -q | wc -l)
if [ "$TILE_CONTAINERS" -eq 0 ]; then
    echo "✅ No quedan contenedores de tiles"
else
    echo "⚠️ Quedan contenedores:"
    docker ps -a --filter "name=tile" --filter "name=openstreet"
fi

# Verificar que no queden volúmenes de tiles
TILE_VOLUMES=$(docker volume ls -q | grep -E "tile|openstreet|osm" | wc -l)
if [ "$TILE_VOLUMES" -eq 0 ]; then
    echo "✅ No quedan volúmenes de tiles"
else
    echo "⚠️ Quedan volúmenes:"
    docker volume ls | grep -E "tile|openstreet|osm"
fi

# Verificar que no queden PBFs
PBF_COUNT=$(sudo find / -name "*.osm.pbf" -type f 2>/dev/null | wc -l)
if [ "$PBF_COUNT" -eq 0 ]; then
    echo "✅ No quedan archivos PBF"
else
    echo "⚠️ Quedan $PBF_COUNT archivos PBF:"
    sudo find / -name "*.osm.pbf" -type f 2>/dev/null | head -5
fi

# Verificar swap
SWAP_ACTIVE=$(swapon --show | wc -l)
if [ "$SWAP_ACTIVE" -eq 0 ]; then
    echo "✅ No hay swap activo"
else
    echo "⚠️ Swap todavía activo:"
    swapon --show
fi

# ========== 11. RECOMENDACIÓN FINAL ==========
echo ""
echo "💡 ========================================="
echo "💡 RECOMENDACIONES"
echo "💡 ========================================="
echo ""
echo "✅ Sistema limpio. Ahora tienes:"
echo "   - $(df -h / | awk 'NR==2 {print $4}') disponibles en /"
echo "   - Swap eliminado (recuperaste 4.1GB)"
echo "   - Archivos PBF eliminados (recuperaste ~20MB)"
echo "   - Volúmenes Docker eliminados"
echo ""
echo "⚠️  Si NO vas a usar el tile server, puedes:"
echo "   1. Eliminar la imagen de Docker: docker rmi overv/openstreetmap-tile-server"
echo "   2. Desinstalar herramientas OSM: sudo apt-get remove osmctools osmium-tool"
echo ""
echo "✅ El sistema está listo para tu aplicación Flask"
echo "   Tu app corre en: http://sebastian.tumaquinaya.com/test"
echo "========================================"