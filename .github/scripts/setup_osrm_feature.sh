#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ CONFIGURANDO OSRM - BARRANQUILLA OFICIAL"
echo "🗺️ ========================================="

# VERIFICAR SI EL MAPA ACTUAL ES EL CORRECTO
OSRM_DIR="/opt/osrm-data"
CURRENT_MAP="$OSRM_DIR/barranquilla-oficial.osrm"

# Si existe el contenedor pero NO existe el mapa nuevo, forzar reinstalación
if docker ps 2>/dev/null | grep -q osrm-backend && [ ! -f "$CURRENT_MAP" ]; then
    echo "🔄 Contenedor OSRM corriendo pero con mapa antiguo. Forzando reinstalación..."
    docker stop osrm-backend 2>/dev/null || true
    docker rm osrm-backend 2>/dev/null || true
    sudo rm -f $OSRM_DIR/puerto-barranquilla.*
    FORCE_REINSTALL=true
elif docker ps 2>/dev/null | grep -q osrm-backend && [ -f "$CURRENT_MAP" ]; then
    echo "✅ OSRM ya está corriendo con mapa de Barranquilla oficial"
    docker ps | grep osrm-backend
    echo ""
    echo "🧪 Probando conectividad OSRM..."
    if curl -s -f http://localhost:5001/nearest/v1/driving/-74.8,10.98 > /dev/null 2>&1; then
        echo "✅ OSRM responde correctamente"
    else
        echo "⚠️ OSRM no responde, reiniciando..."
        docker restart osrm-backend
        sleep 5
    fi
    exit 0
else
    echo "🆕 Instalando OSRM desde cero..."
    FORCE_REINSTALL=true
fi

echo "📦 Instalando dependencias..."

# Instalar Docker si no está instalado
if ! command -v docker &> /dev/null; then
  echo "🐳 Instalando Docker..."
  sudo apt-get update -qq
  sudo apt-get install -y docker.io
  sudo systemctl start docker
  sudo systemctl enable docker
  echo "✅ Docker instalado"
else
  echo "✅ Docker ya está instalado"
fi

# Instalar herramientas OSM con prioridad a osmium
if ! command -v osmium &> /dev/null; then
  echo "🔧 Instalando osmium-tool (prioritario)..."
  sudo apt-get update -qq
  sudo apt-get install -y osmium-tool osmctools
  echo "✅ osmium-tool instalado"
else
  echo "✅ osmium-tool ya está instalado"
fi

# Instalar wget para método de backup
if ! command -v wget &> /dev/null; then
  echo "🔧 Instalando wget..."
  sudo apt-get install -y wget
  echo "✅ wget instalado"
fi

# ========== PERMISOS DE DOCKER ==========
echo "🔧 Configurando permisos de Docker..."

CURRENT_USER=$(whoami)
echo "   Usuario detectado: ${CURRENT_USER}"

if ! groups ${CURRENT_USER} | grep -q docker; then
  echo "   Agregando usuario '${CURRENT_USER}' al grupo docker..."
  sudo usermod -aG docker ${CURRENT_USER}
else
  echo "   Usuario '${CURRENT_USER}' ya está en el grupo docker"
fi

echo "   Reiniciando Docker daemon..."
sudo systemctl restart docker
sleep 2

sudo chmod 666 /var/run/docker.sock
echo "✅ Permisos de Docker configurados"

# Crear directorio para datos OSRM
echo "📁 Creando directorio: ${OSRM_DIR}"
sudo mkdir -p ${OSRM_DIR}
sudo chown ${CURRENT_USER}:${CURRENT_USER} ${OSRM_DIR}
cd ${OSRM_DIR}

# ========== LIMPIAR MAPAS ANTERIORES ==========
echo "🔍 Limpiando mapas anteriores..."
docker stop osrm-backend 2>/dev/null || true
docker rm osrm-backend 2>/dev/null || true
sudo rm -f /opt/osrm-data/puerto-barranquilla.*
sudo rm -f /opt/osrm-data/barranquilla-oficial.*
echo "✅ Limpieza completada"

echo ""
echo "📥 ========================================="
echo "📥 DESCARGANDO MAPA DE BARRANQUILLA"
echo "📥 ========================================="

# Función para validar archivo OSM
validate_osm_file() {
    local file=$1
    local min_size=1000000  # 1MB mínimo
    
    if [ ! -f "$file" ]; then
        echo "❌ Archivo no existe: $file"
        return 1
    fi
    
    local file_size=$(stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0)
    
    if [ $file_size -lt $min_size ]; then
        echo "❌ Archivo muy pequeño: $file_size bytes (mínimo: $min_size)"
        return 1
    fi
    
    # Verificar que sea XML válido con contenido OSM
    if ! grep -q "<osm" "$file" 2>/dev/null; then
        echo "❌ Archivo no contiene datos OSM válidos"
        return 1
    fi
    
    # Verificar que tenga al menos algunas calles
    local way_count=$(grep -c "<way" "$file" 2>/dev/null || echo 0)
    if [ $way_count -lt 100 ]; then
        echo "❌ Archivo con muy pocas calles: $way_count (mínimo: 100)"
        return 1
    fi
    
    echo "✅ Archivo válido: $file_size bytes, $way_count ways"
    return 0
}

# MÉTODO 1: Geofabrik (más confiable)
echo "🌍 MÉTODO 1: Descarga desde Geofabrik..."
echo "   Fuente: https://download.geofabrik.de/"
echo "   Ventaja: Más estable que Overpass API"
echo ""

if wget -O colombia-latest.osm.pbf "https://download.geofabrik.de/south-america/colombia-latest.osm.pbf"; then
    echo "✅ Colombia descargado desde Geofabrik"
    
    # Extraer área de Barranquilla con osmium
    echo "🗺️ Extrayendo área de Barranquilla..."
    
    # Bounding box extendido para incluir área metropolitana
    if osmium extract --bbox -74.95,10.85,-74.70,11.10 colombia-latest.osm.pbf -o barranquilla-geofabrik.osm.pbf --overwrite; then
        echo "✅ Extracción completada"
        
        # Convertir a OSM para validación
        osmium cat barranquilla-geofabrik.osm.pbf -o barranquilla-oficial.osm --overwrite
        
        if validate_osm_file "barranquilla-oficial.osm"; then
            echo "✅ MÉTODO 1 EXITOSO - Usando datos de Geofabrik"
            # Reconvertir a PBF con osmium
            osmium cat barranquilla-oficial.osm -o barranquilla-oficial.osm.pbf --overwrite
            rm -f colombia-latest.osm.pbf barranquilla-geofabrik.osm.pbf barranquilla-oficial.osm
            DOWNLOAD_SUCCESS=true
        else
            echo "❌ MÉTODO 1 falló en validación"
            rm -f barranquilla-oficial.osm
            DOWNLOAD_SUCCESS=false
        fi
    else
        echo "❌ Error en extracción con osmium"
        DOWNLOAD_SUCCESS=false
    fi
    
    rm -f colombia-latest.osm.pbf barranquilla-geofabrik.osm.pbf
else
    echo "❌ MÉTODO 1 falló en descarga"
    DOWNLOAD_SUCCESS=false
fi

# MÉTODO 2: Overpass API (solo si Geofabrik falla)
if [ "$DOWNLOAD_SUCCESS" != "true" ]; then
    echo ""
    echo "🌐 MÉTODO 2: Overpass API (backup)..."
    
    # Query optimizada solo para highways
    OVERPASS_QUERY='[out:xml][timeout:900][maxsize:536870912];
(
  relation(1335179);
  map_to_area;
  way(area)["highway"];
  >;
);
out body;'

    echo "$OVERPASS_QUERY" > /tmp/overpass_query.txt
    
    echo "   Descargando desde Overpass API..."
    echo "   (Puede tardar 5-10 minutos)"
    
    MAX_ATTEMPTS=2
    ATTEMPT=1
    
    while [ $ATTEMPT -le $MAX_ATTEMPTS ] && [ "$DOWNLOAD_SUCCESS" != "true" ]; do
        echo ""
        echo "   Intento $ATTEMPT de $MAX_ATTEMPTS..."
        
        if curl -L --connect-timeout 120 --max-time 900 \
          --retry 1 --retry-delay 10 \
          -d @/tmp/overpass_query.txt \
          "https://overpass-api.de/api/interpreter" \
          -o barranquilla-oficial.osm; then
            
            if validate_osm_file "barranquilla-oficial.osm"; then
                echo "✅ MÉTODO 2 EXITOSO - Usando Overpass API"
                
                # Convertir a PBF con osmium
                osmium cat barranquilla-oficial.osm -o barranquilla-oficial.osm.pbf --overwrite
                rm -f barranquilla-oficial.osm
                DOWNLOAD_SUCCESS=true
            else
                echo "❌ Descarga corrupta en intento $ATTEMPT"
                rm -f barranquilla-oficial.osm
                ATTEMPT=$((ATTEMPT+1))
                if [ $ATTEMPT -le $MAX_ATTEMPTS ]; then
                    echo "   Esperando 30 segundos antes de reintentar..."
                    sleep 30
                fi
            fi
        else
            echo "❌ Error de conexión en intento $ATTEMPT"
            rm -f barranquilla-oficial.osm
            ATTEMPT=$((ATTEMPT+1))
        fi
    done
    
    rm -f /tmp/overpass_query.txt
fi

# MÉTODO 3: Área metropolitana reducida (último recurso)
if [ "$DOWNLOAD_SUCCESS" != "true" ]; then
    echo ""
    echo "🎯 MÉTODO 3: Área reducida (último recurso)..."
    
    # Área más pequeña centrada en Barranquilla
    OVERPASS_QUERY_SMALL='[out:xml][timeout:300][bbox:10.90,-74.85,11.05,-74.75];
(
  way["highway"];
  >;
);
out body;'

    echo "$OVERPASS_QUERY_SMALL" > /tmp/overpass_small.txt
    
    if curl -L --connect-timeout 120 --max-time 300 \
      -d @/tmp/overpass_small.txt \
      "https://overpass-api.de/api/interpreter" \
      -o barranquilla-oficial.osm; then
        
        if validate_osm_file "barranquilla-oficial.osm"; then
            echo "✅ MÉTODO 3 EXITOSO - Área reducida"
            osmium cat barranquilla-oficial.osm -o barranquilla-oficial.osm.pbf --overwrite
            rm -f barranquilla-oficial.osm
            DOWNLOAD_SUCCESS=true
        else
            echo "❌ MÉTODO 3 también falló"
            rm -f barranquilla-oficial.osm
        fi
    fi
    
    rm -f /tmp/overpass_small.txt
fi

# Verificación final
if [ "$DOWNLOAD_SUCCESS" != "true" ]; then
    echo ""
    echo "❌ ERROR CRÍTICO: Todos los métodos de descarga fallaron"
    echo "💡 Posibles causas:"
    echo "   - Problemas de conectividad a internet"
    echo "   - Servidores Overpass sobrecargados"
    echo "   - Geofabrik temporalmente no disponible"
    echo ""
    echo "🔧 Soluciones:"
    echo "   1. Esperar 30-60 minutos y reintentar"
    echo "   2. Verificar conectividad: ping 8.8.8.8"
    echo "   3. Intentar desde otra red"
    exit 1
fi

echo ""
echo "✅ Descarga completada exitosamente"
echo "   Archivo: $(ls -lh barranquilla-oficial.osm.pbf | awk '{print $5}')"

# ========== PROCESAR CON OSRM ==========
echo ""
echo "⚙️ ========================================="
echo "⚙️ PROCESANDO MAPA CON OSRM"
echo "⚙️ ========================================="

echo "📍 Paso 1/3: Extracción de datos de rutas..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/barranquilla-oficial.osm.pbf; then
  echo "❌ Error en extracción OSRM"
  exit 1
fi
echo "✅ Extracción completada"

echo ""
echo "🗂️ Paso 2/3: Particionamiento de grafo..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/barranquilla-oficial.osrm; then
  echo "❌ Error en particionamiento OSRM"
  exit 1
fi
echo "✅ Particionamiento completado"

echo ""
echo "🎨 Paso 3/3: Personalización de rutas..."
if ! docker run -t -v "${PWD}:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/barranquilla-oficial.osrm; then
  echo "❌ Error en personalización OSRM"
  exit 1
fi
echo "✅ Personalización completada"

# Limpiar archivos temporales
rm -f barranquilla-oficial.osm.pbf

echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO SERVIDOR OSRM"
echo "🚀 ========================================="

# Iniciar servidor OSRM
docker run -d --name osrm-backend \
  --restart unless-stopped \
  -p 5001:5000 \
  -v "${PWD}:/data" \
  ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/barranquilla-oficial.osrm

# Verificar funcionamiento
echo "⏳ Verificando OSRM..."
sleep 10

if curl -s -f http://localhost:5001/nearest/v1/driving/-74.8,10.98 > /dev/null 2>&1; then
    echo "✅ OSRM funcionando correctamente"
else
    echo "❌ OSRM no responde"
    docker logs osrm-backend --tail 20
    exit 1
fi

# Configurar servicio systemd
echo "🔧 Configurando servicio systemd..."
sudo tee /etc/systemd/system/osrm.service > /dev/null << SERVICEEOF
[Unit]
Description=OSRM Backend Service - Barranquilla
After=docker.service
Requires=docker.service

[Service]
Type=simple
User=${CURRENT_USER}
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker stop osrm-backend
ExecStartPre=-/usr/bin/docker rm osrm-backend
ExecStart=/usr/bin/docker run --rm --name osrm-backend -p 5001:5000 -v ${OSRM_DIR}:/data ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld /data/barranquilla-oficial.osrm
ExecStop=/usr/bin/docker stop osrm-backend

[Install]
WantedBy=multi-user.target
SERVICEEOF

sudo systemctl daemon-reload
sudo systemctl enable osrm
echo "✅ Servicio systemd configurado"

echo ""
echo "========================================="
echo "🎉 INSTALACIÓN COMPLETADA"
echo "========================================="
echo ""
echo "✅ OSRM corriendo en puerto 5001"
echo "✅ Datos: Barranquilla oficial"
echo "✅ Auto-inicio habilitado"
echo ""
echo "🧪 Prueba: curl http://localhost:5001/nearest/v1/driving/-74.8,10.98"
echo "========================================"