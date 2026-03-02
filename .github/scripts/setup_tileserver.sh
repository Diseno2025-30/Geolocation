#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER NATIVO - SIN DOCKER"
echo "🗺️ ========================================="

CURRENT_USER=$(whoami)
LOCAL_OSM_FILE="/tmp/Geolocation.osm.pbf"
CARTO_DIR="/opt/openstreetmap-carto"
TILE_PORT=8080

# ========== VERIFICAR SI YA ESTÁ FUNCIONANDO ==========

if systemctl is-active --quiet renderd 2>/dev/null; then
  echo "🔍 renderd ya está corriendo, verificando..."
  if curl -sf "http://localhost:${TILE_PORT}/tile/0/0/0.png" > /dev/null 2>&1; then
    echo "✅ Tile server responde correctamente - saltando reinstalación"
    exit 0
  else
    echo "⚠️ renderd corre pero no responde tiles, reinstalando..."
    sudo systemctl stop renderd 2>/dev/null || true
    sudo systemctl stop apache2 2>/dev/null || true
  fi
fi

# ========== LIMPIAR TODO LO DE DOCKER (instalaciones anteriores) ==========

echo ""
echo "🧹 ========================================="
echo "🧹 LIMPIANDO INSTALACIONES ANTERIORES"
echo "🧹 ========================================="

docker update --restart=no tile-server 2>/dev/null || true
docker update --restart=no tile-import 2>/dev/null || true
docker stop tile-server tile-import 2>/dev/null || true
docker rm -f tile-server tile-import 2>/dev/null || true

docker volume rm openstreetmap-tile-data openstreetmap-tile-style 2>/dev/null || true

docker image rm overv/openstreetmap-tile-server 2>/dev/null || true
docker image rm ghcr.io/systemed/tilemaker:master 2>/dev/null || true
docker image rm maptiler/tileserver-gl 2>/dev/null || true

sudo rm -rf /opt/tile-data/barranquilla-completo.* 2>/dev/null || true
sudo rm -rf /opt/tile-data/barranquilla.mbtiles 2>/dev/null || true
sudo rm -rf /opt/tile-data/config.json 2>/dev/null || true
sudo rm -rf /opt/tile-data/styles 2>/dev/null || true

sudo systemctl stop tileserver 2>/dev/null || true
sudo systemctl disable tileserver 2>/dev/null || true
sudo rm -f /etc/systemd/system/tileserver.service
sudo systemctl daemon-reload

echo "✅ Limpieza completa de instalaciones anteriores"

# ========== VERIFICAR PBF ==========

if [ ! -f "$LOCAL_OSM_FILE" ]; then
  echo "❌ Archivo PBF no encontrado: $LOCAL_OSM_FILE"
  exit 1
fi
echo "✅ PBF encontrado: $(ls -lh $LOCAL_OSM_FILE | awk '{print $5}')"

# ========== PASO 1: INSTALAR PAQUETES ==========

echo ""
echo "📦 ========================================="
echo "📦 PASO 1: INSTALANDO PAQUETES"
echo "📦 ========================================="

sudo apt-get update -qq
sudo apt-get install -y \
  postgresql postgresql-contrib postgis \
  osm2pgsql \
  renderd \
  apache2 libapache2-mod-tile \
  python3-psycopg2 python3-yaml python3-requests \
  fonts-noto-cjk fonts-noto-hinted fonts-noto-unhinted fonts-unifont \
  gdal-bin \
  git curl

# npm ya viene con NodeSource (instalado para PM2) - no instalar via apt
sudo npm install -g carto

echo "✅ Paquetes instalados"

# ========== PASO 2: CONFIGURAR POSTGRESQL ==========

echo ""
echo "🐘 ========================================="
echo "🐘 PASO 2: CONFIGURANDO POSTGRESQL"
echo "🐘 ========================================="

sudo systemctl start postgresql
sudo systemctl enable postgresql

sudo -u postgres psql -c "DROP DATABASE IF EXISTS gis;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE gis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS postgis;"
sudo -u postgres psql -d gis -c "CREATE EXTENSION IF NOT EXISTS hstore;"
sudo -u postgres psql -c "CREATE USER ${CURRENT_USER} SUPERUSER;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE gis TO ${CURRENT_USER};"
sudo -u postgres psql -d gis -c "GRANT ALL ON SCHEMA public TO ${CURRENT_USER};"

echo "✅ Base de datos gis lista"

# ========== PASO 3: IMPORTAR PBF ==========

echo ""
echo "📥 ========================================="
echo "📥 PASO 3: IMPORTANDO DATOS OSM"
echo "📥 ========================================="
echo "   Estimado: 2-5 minutos para Barranquilla"

osm2pgsql \
  --create \
  --slim \
  --drop \
  --number-processes 2 \
  --hstore \
  --style /usr/share/osm2pgsql/default.style \
  --cache 512 \
  -d gis \
  "$LOCAL_OSM_FILE"

echo "✅ Datos OSM importados"

# ========== PASO 4: INSTALAR ESTILO Y DESCARGAR SHAPEFILES ==========

echo ""
echo "🎨 ========================================="
echo "🎨 PASO 4: INSTALANDO ESTILO Y SHAPEFILES"
echo "🎨 ========================================="

sudo rm -rf ${CARTO_DIR}
sudo git clone --depth=1 https://github.com/gravitystorm/openstreetmap-carto.git ${CARTO_DIR}
sudo chown -R ${CURRENT_USER}:${CURRENT_USER} ${CARTO_DIR}

cd ${CARTO_DIR}

echo "🌍 Descargando shapefiles externos..."
mkdir -p data
# -D es el argumento correcto para el directorio de datos
python3 scripts/get-external-data.py -D ${CARTO_DIR}/data

echo "✅ Shapefiles descargados"

echo "🖌️ Generando Mapnik XML..."
carto project.mml > mapnik.xml

echo "✅ mapnik.xml generado"

# ========== PASO 5: CONFIGURAR RENDERD ==========

echo ""
echo "⚙️ ========================================="
echo "⚙️ PASO 5: CONFIGURANDO RENDERD"
echo "⚙️ ========================================="

sudo mkdir -p /var/lib/mod_tile /var/run/renderd
sudo chown -R ${CURRENT_USER}:${CURRENT_USER} /var/lib/mod_tile /var/run/renderd

sudo tee /etc/renderd.conf > /dev/null << RENDERD_EOF
[renderd]
pid_file=/var/run/renderd/renderd.pid
stats_file=/var/run/renderd/renderd.stats
socketname=/var/run/renderd/renderd.sock
num_threads=2

[mapnik]
plugins_dir=/usr/lib/mapnik/3.1/input
font_dir=/usr/share/fonts
font_dir_recurse=1

[default]
URI=/tile/
TILEDIR=/var/lib/mod_tile
XML=${CARTO_DIR}/mapnik.xml
HOST=localhost
TILESIZE=256
MINZOOM=0
MAXZOOM=19
RENDERD_EOF

echo "✅ renderd configurado"

# ========== PASO 6: CONFIGURAR APACHE EN PUERTO 8080 ==========

echo ""
echo "🌐 ========================================="
echo "🌐 PASO 6: CONFIGURANDO APACHE"
echo "🌐 ========================================="

sudo a2enmod tile headers 2>/dev/null || true

# Quitar puertos 80 y 443 del ports.conf - Nginx ya los ocupa
sudo sed -i 's/Listen 80//' /etc/apache2/ports.conf
sudo sed -i 's/Listen 443//' /etc/apache2/ports.conf

sudo tee /etc/apache2/sites-available/tile-server.conf > /dev/null << APACHE_EOF
Listen ${TILE_PORT}

<VirtualHost *:${TILE_PORT}>
    ServerName localhost

    LoadTileConfigFile /etc/renderd.conf
    ModTileRenderdSocketName /var/run/renderd/renderd.sock
    ModTileRequestTimeout 0
    ModTileMissingRequestTimeout 30
    ModTileMaxLoadOld 16
    ModTileMaxLoadMissing 50
    ModTileCacheDurationMax 604800
    ModTileCacheDurationDirty 900
    ModTileEnableTileThrottling Off
    ModTileEnableStats Off

    AddTileConfig /tile/ default

    <Directory />
        Options FollowSymLinks
        AllowOverride None
        Require all granted
    </Directory>

    Header set Access-Control-Allow-Origin "*"
    Header set Cache-Control "public, max-age=604800"
</VirtualHost>
APACHE_EOF

sudo a2ensite tile-server 2>/dev/null || true
sudo a2dissite 000-default 2>/dev/null || true
sudo apache2ctl configtest

echo "✅ Apache configurado en puerto ${TILE_PORT}"

# ========== PASO 7: INICIAR SERVICIOS ==========

echo ""
echo "🚀 ========================================="
echo "🚀 PASO 7: INICIANDO SERVICIOS"
echo "🚀 ========================================="

sudo systemctl enable renderd
sudo systemctl restart renderd
sleep 5

sudo systemctl enable apache2
sudo systemctl restart apache2
sleep 5

# ========== VERIFICAR FUNCIONAMIENTO ==========

echo "⏳ Verificando que el tile server responde..."

MAX_RETRIES=30
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -sf "http://localhost:${TILE_PORT}/tile/0/0/0.png" > /dev/null 2>&1; then
    echo "✅ Tile server funcionando"
    READY=true
    break
  fi
  RETRY=$((RETRY + 1))
  [ $((RETRY % 5)) -eq 0 ] && echo "   Esperando... (${RETRY}/${MAX_RETRIES})"
  sleep 5
done

if [ "$READY" = false ]; then
  echo "❌ Tile server no responde después de $((MAX_RETRIES * 5))s"
  echo ""
  echo "📋 Logs renderd:"
  sudo journalctl -u renderd --no-pager -n 30
  echo ""
  echo "📋 Logs apache:"
  sudo journalctl -u apache2 --no-pager -n 20
  exit 1
fi

echo ""
echo "========================================="
echo "🎉 TILE SERVER NATIVO LISTO"
echo "========================================="
echo "   Tiles: http://localhost:${TILE_PORT}/tile/{z}/{x}/{y}.png"
echo ""
echo "   ✅ URL idéntica al stack anterior - sin cambios en Nginx ni Leaflet"
echo "   ✅ Sin Docker, sin problemas de permisos de shapefiles"
echo ""
echo "🧪 PRUEBA:"
echo "   curl -I http://localhost:${TILE_PORT}/tile/13/4541/3633.png"
echo "========================================="