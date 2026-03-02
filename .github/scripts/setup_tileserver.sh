#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER: tilemaker + tileserver-gl"
echo "🗺️ ========================================="

TILE_DIR="/opt/tile-data"
CONTAINER_NAME="tile-server"
CURRENT_USER=$(whoami)

# ========== VERIFICAR SI YA ESTÁ FUNCIONANDO ==========

if docker ps 2>/dev/null | grep -q ${CONTAINER_NAME}; then
  echo "🔍 Tile server ya está corriendo, verificando..."
  if curl -sf "http://localhost:8080/styles/tile/0/0/0.png" > /dev/null 2>&1; then
    echo "✅ Tile server responde correctamente - saltando reinstalación"
    exit 0
  else
    echo "⚠️ Tile server no responde, reinstalando..."
    docker update --restart=no ${CONTAINER_NAME} 2>/dev/null || true
    docker stop ${CONTAINER_NAME} 2>/dev/null || true
    docker rm ${CONTAINER_NAME} 2>/dev/null || true
  fi
fi

# ========== LIMPIAR INSTALACIÓN ANTERIOR ==========

echo "🧹 Limpiando instalación anterior..."
docker stop ${CONTAINER_NAME} 2>/dev/null || true
docker rm -f ${CONTAINER_NAME} 2>/dev/null || true

# Eliminar imagen y volúmenes del stack anterior (overv)
docker image rm overv/openstreetmap-tile-server 2>/dev/null || true
docker volume rm openstreetmap-tile-data openstreetmap-tile-style 2>/dev/null || true

# Preparar directorio limpio
sudo mkdir -p ${TILE_DIR}/styles ${TILE_DIR}/fonts ${TILE_DIR}/sprites
sudo chown -R ${CURRENT_USER}:${CURRENT_USER} ${TILE_DIR}
rm -f ${TILE_DIR}/barranquilla.mbtiles
rm -f ${TILE_DIR}/config.json
rm -f ${TILE_DIR}/styles/style.json

echo "✅ Limpieza completada"

# ========== VERIFICAR PBF ==========

LOCAL_OSM_FILE="/tmp/Geolocation.osm.pbf"
if [ ! -f "$LOCAL_OSM_FILE" ]; then
  echo "❌ Archivo PBF no encontrado: $LOCAL_OSM_FILE"
  exit 1
fi
echo "✅ PBF encontrado: $(ls -lh $LOCAL_OSM_FILE | awk '{print $5}')"

# ========== PASO 1: GENERAR MBTILES CON TILEMAKER ==========

echo ""
echo "📦 ========================================="
echo "📦 PASO 1: GENERANDO MBTILES CON TILEMAKER"
echo "📦 ========================================="
echo "   Estimado: 3-8 minutos para Barranquilla"
echo "   Sin descargas externas - solo usa el PBF local"
echo ""

docker run --rm \
  -v ${LOCAL_OSM_FILE}:/data/input.osm.pbf \
  -v ${TILE_DIR}:/data/output \
  ghcr.io/systemed/tilemaker \
  --input /data/input.osm.pbf \
  --output /data/output/barranquilla.mbtiles \
  --config /usr/share/tilemaker/config-openmaptiles.json \
  --process /usr/share/tilemaker/process-openmaptiles.lua

if [ ! -f "${TILE_DIR}/barranquilla.mbtiles" ]; then
  echo "❌ Error: MBTiles no fue generado"
  exit 1
fi

echo "✅ MBTiles generado: $(ls -lh ${TILE_DIR}/barranquilla.mbtiles | awk '{print $5}')"

# ========== PASO 2: CREAR ESTILO DEL MAPA ==========

echo ""
echo "🎨 ========================================="
echo "🎨 PASO 2: CREANDO ESTILO DEL MAPA"
echo "🎨 ========================================="
echo "   Estilo embebido - sin dependencias externas"
echo ""

# Estilo minimalista compatible con OpenMapTiles (esquema que genera tilemaker)
# Sin fuentes/sprites externos - solo geometría y color
cat > ${TILE_DIR}/styles/style.json << 'STYLE_EOF'
{
  "version": 8,
  "name": "Barranquilla",
  "sources": {
    "openmaptiles": {
      "type": "vector",
      "url": "mbtiles://barranquilla"
    }
  },
  "layers": [
    {
      "id": "background",
      "type": "background",
      "paint": { "background-color": "#f0ebe3" }
    },
    {
      "id": "water",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "water",
      "paint": { "fill-color": "#9bc4e0" }
    },
    {
      "id": "waterway",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "waterway",
      "paint": { "line-color": "#9bc4e0", "line-width": 1.5 }
    },
    {
      "id": "landuse-residential",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landuse",
      "filter": ["==", "class", "residential"],
      "paint": { "fill-color": "#e8e0d8", "fill-opacity": 0.7 }
    },
    {
      "id": "landuse-park",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landuse",
      "filter": ["in", "class", "park", "grass", "cemetery", "forest"],
      "paint": { "fill-color": "#b8d4a8" }
    },
    {
      "id": "landuse-commercial",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "landuse",
      "filter": ["in", "class", "commercial", "industrial"],
      "paint": { "fill-color": "#ddd0c0", "fill-opacity": 0.5 }
    },
    {
      "id": "building",
      "type": "fill",
      "source": "openmaptiles",
      "source-layer": "building",
      "minzoom": 13,
      "paint": {
        "fill-color": "#d4cfc8",
        "fill-outline-color": "#b0a8a0"
      }
    },
    {
      "id": "road-track",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "track", "path"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": { "line-color": "#d0c8c0", "line-width": 1 }
    },
    {
      "id": "road-minor",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "minor", "service"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": { "line-color": "#ffffff", "line-width": 1.5 }
    },
    {
      "id": "road-secondary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "secondary", "tertiary"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": { "line-color": "#ffffff", "line-width": 3 }
    },
    {
      "id": "road-primary",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["in", "class", "primary", "trunk"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": { "line-color": "#ffd080", "line-width": 5 }
    },
    {
      "id": "road-motorway",
      "type": "line",
      "source": "openmaptiles",
      "source-layer": "transportation",
      "filter": ["==", "class", "motorway"],
      "layout": { "line-cap": "round", "line-join": "round" },
      "paint": { "line-color": "#ff9040", "line-width": 6 }
    }
  ]
}
STYLE_EOF

echo "✅ Estilo creado"

# ========== PASO 3: CREAR CONFIGURACIÓN TILESERVER-GL ==========

cat > ${TILE_DIR}/config.json << CONFIG_EOF
{
  "options": {
    "paths": {
      "root": "/data",
      "fonts": "fonts",
      "sprites": "sprites",
      "styles": "styles",
      "mbtiles": "/data"
    }
  },
  "data": {
    "barranquilla": {
      "mbtiles": "/data/barranquilla.mbtiles"
    }
  },
  "styles": {
    "tile": {
      "style": "styles/style.json"
    }
  }
}
CONFIG_EOF

echo "✅ Configuración tileserver-gl creada"

# ========== PASO 4: INICIAR TILESERVER-GL ==========

echo ""
echo "🚀 ========================================="
echo "🚀 PASO 3: INICIANDO TILESERVER-GL"
echo "🚀 ========================================="

docker run -d \
  --name ${CONTAINER_NAME} \
  --restart unless-stopped \
  --memory=600m \
  -p 8080:8080 \
  -v ${TILE_DIR}:/data \
  maptiler/tileserver-gl \
  --config /data/config.json \
  --public_url http://localhost:8080/

echo "⏳ Esperando arranque del contenedor..."
sleep 15

CONTAINER_STATUS=$(docker inspect ${CONTAINER_NAME} --format='{{.State.Status}}' 2>/dev/null || echo "missing")
if [ "$CONTAINER_STATUS" != "running" ]; then
  echo "❌ El contenedor no está corriendo (estado: ${CONTAINER_STATUS})"
  docker logs --tail 30 ${CONTAINER_NAME} 2>&1
  exit 1
fi

# ========== VERIFICAR FUNCIONAMIENTO ==========

echo "⏳ Verificando que el tile server responde..."

MAX_RETRIES=30
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -sf "http://localhost:8080/styles/tile/0/0/0.png" > /dev/null 2>&1; then
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
  echo "📋 Logs:"
  docker logs --tail 50 ${CONTAINER_NAME} 2>&1
  exit 1
fi

# ========== CONFIGURAR SERVICIO SYSTEMD ==========

echo "🔧 Configurando servicio systemd..."

sudo tee /etc/systemd/system/tileserver.service > /dev/null << SERVICEEOF
[Unit]
Description=Tile Server - Barranquilla (tileserver-gl)
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=${CURRENT_USER}
Restart=always
RestartSec=15
ExecStartPre=-/usr/bin/docker stop ${CONTAINER_NAME}
ExecStartPre=-/usr/bin/docker rm ${CONTAINER_NAME}
ExecStart=/usr/bin/docker run --rm --name ${CONTAINER_NAME} --memory=600m -p 8080:8080 -v ${TILE_DIR}:/data maptiler/tileserver-gl --config /data/config.json --public_url http://localhost:8080/
ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable tileserver
echo "✅ Servicio systemd configurado"

echo ""
echo "========================================="
echo "🎉 TILE SERVER LISTO"
echo "========================================="
echo "   Tiles PNG: http://localhost:8080/styles/tile/{z}/{x}/{y}.png"
echo "   Puerto:    8080"
echo ""
echo "🧪 PRUEBA:"
echo "   curl -I http://localhost:8080/styles/tile/13/4541/3633.png"
echo "========================================="