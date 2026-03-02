#!/bin/bash
set -e

echo "🧹 ========================================="
echo "🧹 LIMPIEZA TOTAL - TILE SERVER"
echo "🧹 ========================================="

# ========== DOCKER ==========
echo "🐳 Limpiando Docker..."
docker update --restart=no tile-server 2>/dev/null || true
docker update --restart=no tile-import 2>/dev/null || true
docker stop tile-server tile-import 2>/dev/null || true
docker rm -f tile-server tile-import 2>/dev/null || true
docker volume rm openstreetmap-tile-data openstreetmap-tile-style 2>/dev/null || true
docker image rm overv/openstreetmap-tile-server 2>/dev/null || true
docker image rm ghcr.io/systemed/tilemaker:master 2>/dev/null || true
docker image rm maptiler/tileserver-gl 2>/dev/null || true
echo "✅ Docker limpio"

# ========== SERVICIOS SYSTEMD ==========
echo "⚙️ Deteniendo servicios..."
sudo systemctl stop renderd 2>/dev/null || true
sudo systemctl stop apache2 2>/dev/null || true
sudo systemctl stop tileserver 2>/dev/null || true
sudo systemctl disable renderd 2>/dev/null || true
sudo systemctl disable apache2 2>/dev/null || true
sudo systemctl disable tileserver 2>/dev/null || true
sudo rm -f /etc/systemd/system/tileserver.service
sudo systemctl daemon-reload
echo "✅ Servicios detenidos"

# ========== PAQUETES APT ==========
echo "📦 Desinstalando paquetes..."
sudo apt-get remove -y --purge \
  renderd \
  apache2 apache2-* libapache2-mod-tile \
  osm2pgsql \
  postgresql postgresql-* postgis \
  gdal-bin 2>/dev/null || true
sudo apt-get autoremove -y 2>/dev/null || true
echo "✅ Paquetes desinstalados"

# ========== ARCHIVOS Y DIRECTORIOS ==========
echo "🗑️ Eliminando archivos..."
sudo rm -rf /opt/openstreetmap-carto
sudo rm -rf /opt/tile-data
sudo rm -rf /var/lib/postgresql
sudo rm -rf /var/lib/mod_tile
sudo rm -rf /var/cache/renderd
sudo rm -rf /var/run/renderd
sudo rm -rf /etc/renderd.conf
sudo rm -rf /etc/apache2/sites-available/tile-server.conf
sudo rm -rf /etc/postgresql
sudo rm -f /tmp/Geolocation.osm.pbf
echo "✅ Archivos eliminados"

# ========== NPM GLOBAL ==========
echo "📦 Limpiando carto de npm..."
sudo npm uninstall -g carto 2>/dev/null || true
echo "✅ carto eliminado"

echo ""
echo "========================================="
echo "🎉 LIMPIEZA TOTAL COMPLETADA"
echo "   La EC2 está en estado base limpio"
echo "========================================="