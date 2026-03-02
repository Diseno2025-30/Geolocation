#!/bin/bash
set -e

echo "🧹 ========================================="
echo "🧹 LIMPIEZA TOTAL AUTOMÁTICA - TILE SERVER"
echo "🧹 ========================================="

# ========== 1. MATAR CONTENEDORES ==========
echo "1️⃣ Eliminando contenedores..."
docker stop $(docker ps -a -q --filter "name=tile" --filter "name=openstreet" --filter "name=osm") 2>/dev/null || true
docker rm -f $(docker ps -a -q --filter "name=tile" --filter "name=openstreet" --filter "name=osm") 2>/dev/null || true
docker rm -f tile-import tile-server 2>/dev/null || true

# ========== 2. ELIMINAR VOLÚMENES ==========
echo "2️⃣ Eliminando volúmenes..."
docker volume rm -f openstreetmap-tile-data 2>/dev/null || true
docker volume rm -f $(docker volume ls -q --filter "name=tile") 2>/dev/null || true
docker volume prune -f 2>/dev/null || true

# ========== 3. ELIMINAR IMÁGENES ==========
echo "3️⃣ Eliminando imágenes..."
docker rmi -f overv/openstreetmap-tile-server:latest 2>/dev/null || true
docker image prune -f 2>/dev/null || true

# ========== 4. ELIMINAR ARCHIVOS PBF ==========
echo "4️⃣ Eliminando archivos PBF..."
sudo rm -rf /opt/tile-data 2>/dev/null || true
sudo rm -f /tmp/*.osm.pbf 2>/dev/null || true
sudo rm -f /tmp/*.osm.bz2 2>/dev/null || true
sudo rm -f /home/ubuntu/*.osm.pbf 2>/dev/null || true
find / -name "*.osm.pbf" -type f 2>/dev/null -exec sudo rm -f {} \; 2>/dev/null || true

# ========== 5. ELIMINAR ARCHIVOS TEMPORALES ==========
echo "5️⃣ Eliminando archivos temporales..."
sudo rm -f /tmp/import-*.sh 2>/dev/null || true
sudo rm -f /tmp/custom-*.sh 2>/dev/null || true
sudo rm -f /tmp/renderd*.conf 2>/dev/null || true
sudo rm -f /tmp/tile-server-*.log 2>/dev/null || true
sudo rm -f /home/ubuntu/*tile*.sh 2>/dev/null || true
sudo rm -f /tmp/test.png 2>/dev/null || true

# ========== 6. ELIMINAR SERVICIOS ==========
echo "6️⃣ Eliminando servicios systemd..."
sudo systemctl stop tileserver 2>/dev/null || true
sudo systemctl disable tileserver 2>/dev/null || true
sudo rm -f /etc/systemd/system/tileserver.service 2>/dev/null || true
sudo systemctl daemon-reload 2>/dev/null || true

# ========== 7. LIMPIEZA DOCKER ==========
echo "7️⃣ Limpieza final de Docker..."
docker system prune -a -f --volumes 2>/dev/null || true

# ========== 8. VERIFICACIÓN ==========
echo ""
echo "🔍 VERIFICACIÓN FINAL:"
echo "--------------------------------"
echo "Contenedores tile: $(docker ps -a | grep -c -E "tile|openstreet|osm" || echo "0")"
echo "Volúmenes tile: $(docker volume ls | grep -c -E "tile|openstreet|osm" || echo "0")"
echo "Imágenes tile: $(docker images | grep -c "openstreetmap-tile-server" || echo "0")"
echo "Archivos PBF: $(find / -name "*.osm.pbf" -type f 2>/dev/null | wc -l || echo "0")"
echo ""

# ========== 9. MOSTRAR ESPACIO ==========
echo "📊 ESPACIO EN DISCO:"
df -h / | awk 'NR==2 {print "   Usado: " $3 " | Libre: " $4}'
echo ""

echo "✅ LIMPIEZA COMPLETADA"