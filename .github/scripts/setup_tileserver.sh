#!/bin/bash
set -e

TILEMAKER_DIR="/opt/tilemaker"
TILESERVER_DATA="/opt/tileserver"
MBTILES_FILE="${TILEMAKER_DIR}/barranquilla.mbtiles"
PBF_SOURCE="/home/ubuntu/Web-server-UDP/test/.github/osm/Geolocation.osm.pbf"

echo "🗺️ ========================================="
echo "🗺️ SETUP TILE SERVER - BARRANQUILLA"
echo "🗺️ ========================================="

# PASO 1: Directorios
echo ""
echo "📁 PASO 1: Preparando directorios..."
sudo mkdir -p ${TILEMAKER_DIR}
sudo mkdir -p ${TILESERVER_DATA}
sudo chown ubuntu:ubuntu ${TILEMAKER_DIR}
sudo chown ubuntu:ubuntu ${TILESERVER_DATA}
echo "✅ Directorios listos"

# PASO 2: Convertir PBF → MBTiles (con caché)
echo ""
echo "🔄 PASO 2: Verificando MBTiles..."

if [ -f "${MBTILES_FILE}" ] && [ -s "${MBTILES_FILE}" ]; then
    echo "✅ MBTiles ya existe ($(ls -lh ${MBTILES_FILE} | awk '{print $5}')), saltando conversión"
else
    echo "   MBTiles no encontrado, iniciando conversión..."

    if [ ! -f "${PBF_SOURCE}" ]; then
        echo "❌ ERROR: PBF no encontrado en ${PBF_SOURCE}"
        exit 1
    fi
    echo "   PBF fuente: $(ls -lh ${PBF_SOURCE} | awk '{print $5}')"

    cp "${PBF_SOURCE}" "${TILEMAKER_DIR}/input.osm.pbf"

    cat > ${TILEMAKER_DIR}/config.json << 'CONFIGEOF'
{
    "layers": {
        "roads":     { "minzoom": 10, "maxzoom": 14 },
        "buildings": { "minzoom": 14, "maxzoom": 14 },
        "places":    { "minzoom": 8,  "maxzoom": 14 },
        "landuse":   { "minzoom": 10, "maxzoom": 14 }
    },
    "settings": {
        "minzoom": 10,
        "maxzoom": 14,
        "basezoom": 12,
        "include_ids": false,
        "name": "Barranquilla",
        "description": "Barranquilla tiles",
        "compress": "gzip"
    }
}
CONFIGEOF

    cat > ${TILEMAKER_DIR}/process.lua << 'LUAEOF'
-- process.lua - Barranquilla (sin capas de agua)
local highway_class = {
    motorway="motorway", trunk="trunk", primary="primary",
    secondary="secondary", tertiary="tertiary", residential="residential",
    service="service", unclassified="unclassified", living_street="living_street",
    pedestrian="pedestrian", footway="footway", path="path",
    cycleway="cycleway", steps="steps"
}

function node_function(node, layer)
    local place = node:Find("place")
    if place ~= "" then
        layer:LayerAsCentroid("places")
        layer:Attribute("name", node:Find("name"))
        layer:Attribute("place", place)
    end
end

function way_function(way, layer)
    local highway  = way:Find("highway")
    local building = way:Find("building")
    local landuse  = way:Find("landuse")

    if highway ~= "" then
        local class = highway_class[highway]
        if class then
            layer:Layer("roads", false)
            layer:Attribute("class", class)
            layer:Attribute("name", way:Find("name"))
        end
    end

    if building ~= "" then
        layer:Layer("buildings", true)
        layer:Attribute("building", building)
    end

    if landuse ~= "" and landuse ~= "reservoir" and landuse ~= "basin" then
        layer:Layer("landuse", true)
        layer:Attribute("landuse", landuse)
    end
end
LUAEOF

    echo "   Ejecutando tilemaker (puede tardar 1-3 min)..."
    docker run --rm \
        -v "${TILEMAKER_DIR}:/data" \
        ghcr.io/systemed/tilemaker:master \
        /data/input.osm.pbf \
        --output /data/barranquilla.mbtiles \
        --config /data/config.json \
        --process /data/process.lua

    if [ ! -f "${MBTILES_FILE}" ] || [ ! -s "${MBTILES_FILE}" ]; then
        echo "❌ ERROR: MBTiles no fue generado"
        exit 1
    fi

    echo "✅ MBTiles generado: $(ls -lh ${MBTILES_FILE} | awk '{print $5}')"
    rm -f "${TILEMAKER_DIR}/input.osm.pbf"
fi

# PASO 3: Config de tileserver-gl
echo ""
echo "⚙️  PASO 3: Preparando configuración de tileserver-gl..."

cp "${MBTILES_FILE}" "${TILESERVER_DATA}/barranquilla.mbtiles"

cat > ${TILESERVER_DATA}/style.json << 'STYLEEOF'
{
    "version": 8,
    "name": "Barranquilla",
    "glyphs": "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    "sources": {
        "barranquilla": {
            "type": "vector",
            "url": "mbtiles://barranquilla.mbtiles"
        }
    },
    "layers": [
        {
            "id": "background",
            "type": "background",
            "paint": { "background-color": "#f8f4f0" }
        },
        {
            "id": "landuse-fill",
            "type": "fill",
            "source": "barranquilla",
            "source-layer": "landuse",
            "paint": {
                "fill-color": [
                    "match", ["get", "landuse"],
                    "park", "#c8e6c9", "grass", "#dcedc8",
                    "forest", "#a5d6a7", "residential", "#ede7e0",
                    "commercial", "#ffe0b2", "industrial", "#e0e0e0",
                    "#ede7e0"
                ],
                "fill-opacity": 0.7
            }
        },
        {
            "id": "buildings-fill",
            "type": "fill",
            "source": "barranquilla",
            "source-layer": "buildings",
            "minzoom": 14,
            "paint": {
                "fill-color": "#d4c8b8",
                "fill-outline-color": "#b8a898"
            }
        },
        {
            "id": "roads-minor",
            "type": "line",
            "source": "barranquilla",
            "source-layer": "roads",
            "filter": ["in", "class", "residential", "service",
                "unclassified", "living_street", "footway",
                "path", "steps", "pedestrian", "cycleway"],
            "layout": { "line-cap": "round", "line-join": "round" },
            "paint": {
                "line-color": "#ffffff",
                "line-width": ["interpolate", ["linear"], ["zoom"],
                    12, 0.5, 16, 3, 18, 5]
            }
        },
        {
            "id": "roads-secondary",
            "type": "line",
            "source": "barranquilla",
            "source-layer": "roads",
            "filter": ["in", "class", "secondary", "tertiary"],
            "layout": { "line-cap": "round", "line-join": "round" },
            "paint": {
                "line-color": "#f0ebe0",
                "line-width": ["interpolate", ["linear"], ["zoom"],
                    10, 0.5, 14, 3, 18, 7]
            }
        },
        {
            "id": "roads-primary",
            "type": "line",
            "source": "barranquilla",
            "source-layer": "roads",
            "filter": ["in", "class", "primary", "trunk", "motorway"],
            "layout": { "line-cap": "round", "line-join": "round" },
            "paint": {
                "line-color": "#ffd166",
                "line-width": ["interpolate", ["linear"], ["zoom"],
                    8, 1, 12, 4, 18, 10]
            }
        },
        {
            "id": "places-labels",
            "type": "symbol",
            "source": "barranquilla",
            "source-layer": "places",
            "layout": {
                "text-field": ["get", "name"],
                "text-size": ["interpolate", ["linear"], ["zoom"], 10, 10, 14, 14],
                "text-font": ["Open Sans Regular"],
                "text-max-width": 8
            },
            "paint": {
                "text-color": "#333333",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.5
            }
        }
    ]
}
STYLEEOF

cat > ${TILESERVER_DATA}/config.json << 'TILESERVERCFG'
{
    "options": {
        "paths": {
            "root": "/data",
            "fonts": "/usr/share/fonts",
            "styles": "/data",
            "mbtiles": "/data"
        }
    },
    "styles": {
        "tile": {
            "style": "style.json"
        }
    },
    "data": {
        "barranquilla": {
            "mbtiles": "barranquilla.mbtiles"
        }
    }
}
TILESERVERCFG

echo "✅ Configuración creada"

# PASO 4: Levantar tileserver-gl
echo ""
echo "🚀 PASO 4: Levantando tileserver-gl..."

docker stop tile-server 2>/dev/null || true
docker rm   tile-server 2>/dev/null || true
sudo fuser -k 8080/tcp 2>/dev/null || true
sleep 2

if ! docker image inspect maptiler/tileserver-gl:latest > /dev/null 2>&1; then
    echo "   Descargando imagen maptiler/tileserver-gl..."
    docker pull maptiler/tileserver-gl:latest
else
    echo "   Imagen ya existe localmente"
fi

docker run -d \
    --name tile-server \
    --restart unless-stopped \
    -p 8080:8080 \
    -v "${TILESERVER_DATA}:/data" \
    maptiler/tileserver-gl:latest \
    --config /data/config.json \
    --port 8080

echo "   Contenedor iniciado, esperando que esté listo..."

# PASO 5: Verificar
echo ""
echo "🧪 PASO 5: Verificando tile server..."

MAX_RETRIES=20
RETRY=0
READY=false

while [ $RETRY -lt $MAX_RETRIES ]; do
    if curl -s -f http://localhost:8080/ > /dev/null 2>&1; then
        READY=true
        break
    fi
    RETRY=$((RETRY+1))
    echo "   Intento ${RETRY}/${MAX_RETRIES}..."
    sleep 3
done

if [ "$READY" = false ]; then
    echo "❌ ERROR: tileserver-gl no responde"
    echo ""
    echo "📋 Logs:"
    docker logs tile-server --tail 40
    exit 1
fi

echo "✅ tileserver-gl responde en http://localhost:8080/"

echo "   Probando tile PNG (z=13 x=2393 y=3843 → centro Barranquilla)..."
if curl -s -f "http://localhost:8080/styles/tile/13/2393/3843.png" -o /tmp/test_tile.png 2>&1; then
    echo "✅ Tile PNG generado: $(ls -lh /tmp/test_tile.png | awk '{print $5}')"
    rm -f /tmp/test_tile.png
else
    echo "⚠️  Tile de prueba no respondió - revisa: docker logs tile-server --tail 20"
fi

echo ""
echo "========================================="
echo "✅ TILE SERVER LISTO"
echo "========================================="
echo "   Endpoint PNG:  http://localhost:8080/styles/tile/{z}/{x}/{y}.png"
echo "   Health check:  http://localhost:8080/"
echo "   MBTiles:       ${TILESERVER_DATA}/barranquilla.mbtiles"
echo "   Logs:          docker logs tile-server -f"
echo "========================================="