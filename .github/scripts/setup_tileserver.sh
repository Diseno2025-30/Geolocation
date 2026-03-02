#!/bin/bash
set -e

echo "🧹 ========================================="
echo "🧹 LIMPIEZA TOTAL AUTOMÁTICA DEL TILE SERVER"
echo "🧹 ========================================="
echo ""

# 1. Detener y eliminar contenedor tile-server
echo "📦 PASO 1: Eliminando contenedor tile-server..."
docker stop tile-server 2>/dev/null || true
docker rm tile-server 2>/dev/null || true
echo "   ✅ Contenedor eliminado"

# 2. Eliminar TODAS las imágenes relacionadas con tiles
echo "🖼️  PASO 2: Eliminando imágenes Docker..."
docker rmi maptiler/tileserver-gl:latest 2>/dev/null || true
docker rmi ghcr.io/systemed/tilemaker:master 2>/dev/null || true
echo "   ✅ Imágenes eliminadas"

# 3. Eliminar directorios completos de tilemaker y tileserver
echo "📁 PASO 3: Eliminando directorios y archivos..."
sudo rm -rf /opt/tilemaker
sudo rm -rf /opt/tileserver
echo "   ✅ Directorios eliminados"

# 4. Eliminar archivos MBTiles dispersos (búsqueda profunda)
echo "🔍 PASO 4: Eliminando archivos .mbtiles..."
find /home/ubuntu -name "*.mbtiles" -type f -delete 2>/dev/null || true
find /opt -name "*.mbtiles" -type f -delete 2>/dev/null || true
find /tmp -name "*.mbtiles" -type f -delete 2>/dev/null || true
echo "   ✅ Archivos .mbtiles eliminados"

# 5. Eliminar archivos temporales específicos
echo "🗑️  PASO 5: Eliminando archivos temporales..."
rm -f /tmp/test_tile.png 2>/dev/null || true
rm -rf /opt/tilemaker/tmp 2>/dev/null || true
echo "   ✅ Archivos temporales eliminados"

# 6. Eliminar swap SI existe (automático)
echo "💾 PASO 6: Eliminando swap file..."
if [ -f /swapfile ]; then
    sudo swapoff /swapfile 2>/dev/null || true
    sudo rm -f /swapfile
    sudo sed -i '/swapfile/d' /etc/fstab 2>/dev/null || true
    echo "   ✅ Swap eliminado"
else
    echo "   ⏭️  No había swap"
fi

# 7. Liberar puerto 8080 (automático)
echo "🔌 PASO 7: Liberando puerto 8080..."
sudo fuser -k 8080/tcp 2>/dev/null || true
echo "   ✅ Puerto 8080 liberado"

# 8. Limpieza adicional de Docker (opcional pero recomendado)
echo "🧼 PASO 8: Limpieza de Docker..."
docker system prune -f 2>/dev/null || true
echo "   ✅ Docker limpiado"

echo ""
echo "🧹 ========================================="
echo "🧹 LIMPIEZA COMPLETADA EXITOSAMENTE"
echo "🧹 ========================================="