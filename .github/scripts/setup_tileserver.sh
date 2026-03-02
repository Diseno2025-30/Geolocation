#!/bin/bash
set -e

echo "🗺️ ========================================="
echo "🗺️ TILE SERVER PARA c7i.flex-large"
echo "🗺️ ========================================="
echo "🎯 Optimizado para 4GB RAM y 2 vCPUs"
echo "🎯 Con manejo inteligente de almacenamiento"
echo ""

# ========== CONFIGURACIÓN ==========
TILE_DIR="/opt/tile-data"
TILE_VOLUME="openstreetmap-tile-data"
CONTAINER_NAME="tile-server"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="/tmp/tile-server-install-${TIMESTAMP}.log"

# Redirigir todo a log
exec > >(tee -a ${LOG_FILE}) 2>&1

echo "📝 Log guardado en: ${LOG_FILE}"
echo ""

# ========== VERIFICAR ESPACIO EN DISCO ==========
echo "💾 ========================================="
echo "💾 VERIFICANDO ALMACENAMIENTO"
echo "💾 ========================================="

# Obtener información del disco
DISK_AVAILABLE=$(df -BG /opt | awk 'NR==2 {print $4}' | sed 's/G//')
DISK_TOTAL=$(df -BG /opt | awk 'NR==2 {print $2}' | sed 's/G//')
DISK_USED=$(df -BG /opt | awk 'NR==2 {print $3}' | sed 's/G//')
DISK_USE_PERCENT=$(df -h /opt | awk 'NR==2 {print $5}')

echo "📊 Espacio en /opt:"
echo "   - Total: ${DISK_TOTAL}GB"
echo "   - Usado: ${DISK_USED}GB"
echo "   - Disponible: ${DISK_AVAILABLE}GB"
echo "   - Uso: ${DISK_USE_PERCENT}"

# Verificar si hay suficiente espacio (recomendado: 20GB+ para tiles)
if [ "$DISK_AVAILABLE" -lt 20 ]; then
    echo "⚠️  POCO ESPACIO DISPONIBLE: ${DISK_AVAILABLE}GB"
    echo "   Los tiles pueden ocupar 10-30GB dependiendo del zoom"
    echo ""
    echo "OPCIONES:"
    echo "1. Continuar igual (peligro de llenar disco)"
    echo "2. Usar volumen EBS adicional (recomendado)"
    echo "3. Salir"
    echo ""
    echo -n "Selecciona una opción (1-3): "
    read -r option
    
    case $option in
        2)
            echo "📦 Configurando volumen EBS adicional..."
            
            # Buscar dispositivos EBS adicionales
            EBS_DEVICES=$(lsblk -o NAME,SIZE,TYPE,MOUNTPOINT | grep disk | grep -v "xvda\|nvme0n1" | awk '{print $1}')
            
            if [ -n "$EBS_DEVICES" ]; then
                echo "Dispositivos encontrados:"
                echo "$EBS_DEVICES"
                
                # Usar el primer dispositivo
                DEVICE="/dev/$(echo $EBS_DEVICES | head -1)"
                echo "Usando: $DEVICE"
                
                # Formatear si no tiene sistema de archivos
                if ! blkid $DEVICE; then
                    echo "Formateando $DEVICE como ext4..."
                    sudo mkfs.ext4 $DEVICE
                fi
                
                # Montar en /opt/tile-data
                sudo mkdir -p /opt/tile-data
                sudo mount $DEVICE /opt/tile-data
                
                # Agregar a fstab
                UUID=$(sudo blkid -s UUID -o value $DEVICE)
                echo "UUID=$UUID /opt/tile-data ext4 defaults,nofail 0 2" | sudo tee -a /etc/fstab
                
                echo "✅ Volumen EBS montado en /opt/tile-data"
            else
                echo "❌ No se encontraron volúmenes EBS adicionales"
                echo "   Continuando con espacio limitado..."
            fi
            ;;
        3)
            echo "❌ Saliendo..."
            exit 1
            ;;
    esac
fi

# Crear directorio con permisos
sudo mkdir -p ${TILE_DIR}
sudo chown -R $(whoami):$(whoami) ${TILE_DIR}

# ========== LIMPIEZA SELECTIVA ==========
echo ""
echo "🧹 ========================================="
echo "🧹 LIMPIEZA SELECTIVA"
echo "🧹 ========================================="

# Función para preguntar antes de limpiar
confirm_clean() {
    echo ""
    echo "¿Qué quieres limpiar?"
    echo "1. Solo contenedores (rápido)"
    echo "2. Contenedores y volúmenes (borra datos importados)"
    echo "3. Todo (limpieza profunda - recomendado para reinstalación)"
    echo "4. No limpiar nada (continuar)"
    echo ""
    echo -n "Selecciona (1-4): "
    read -r clean_option
    
    case $clean_option in
        1)
            echo "Deteniendo y eliminando contenedores..."
            docker stop ${CONTAINER_NAME} 2>/dev/null || true
            docker stop tile-import 2>/dev/null || true
            docker rm ${CONTAINER_NAME} 2>/dev/null || true
            docker rm tile-import 2>/dev/null || true
            ;;
        2)
            echo "Eliminando contenedores y volúmenes..."
            docker stop ${CONTAINER_NAME} 2>/dev/null || true
            docker stop tile-import 2>/dev/null || true
            docker rm -f ${CONTAINER_NAME} 2>/dev/null || true
            docker rm -f tile-import 2>/dev/null || true
            docker volume rm ${TILE_VOLUME} 2>/dev/null || true
            ;;
        3)
            echo "LIMPIEZA PROFUNDA..."
            # Detener todo
            docker stop $(docker ps -a -q) 2>/dev/null || true
            docker rm -f $(docker ps -a -q) 2>/dev/null || true
            
            # Eliminar volúmenes relacionados
            for vol in $(docker volume ls -q | grep -E "tile|openstreet|osm"); do
                docker volume rm $vol 2>/dev/null || true
            done
            
            # Limpiar archivos pero preguntar por PBF
            echo "¿Eliminar archivos PBF descargados? (s/n): "
            read -r del_pbf
            if [[ "$del_pbf" =~ ^[Ss]$ ]]; then
                rm -f ${TILE_DIR}/*.osm.pbf
            fi
            
            # Limpiar cache de Docker
            docker system prune -f
            ;;
        4)
            echo "Continuando sin limpiar..."
            ;;
    esac
}

# Preguntar solo si hay algo corriendo
if docker ps -a | grep -q -E "tile|openstreet"; then
    confirm_clean
else
    echo "✅ No hay contenedores previos, continuando..."
fi

# ========== VERIFICAR RECURSOS ==========
echo ""
echo "🔧 ========================================="
echo "🔧 CONFIGURACIÓN DEL SISTEMA"
echo "🔧 ========================================="

# Mostrar recursos disponibles
CPU_CORES=$(nproc)
TOTAL_RAM=$(free -g | grep Mem | awk '{print $2}')
if [ -z "$TOTAL_RAM" ] || [ "$TOTAL_RAM" -eq 0 ]; then
    TOTAL_RAM=$(free -m | grep Mem | awk '{print $2}')
    TOTAL_RAM_GB=$((TOTAL_RAM / 1024))
else
    TOTAL_RAM_GB=$TOTAL_RAM
fi

echo "📊 RECURSOS DETECTADOS:"
echo "   - CPUs: ${CPU_CORES} núcleos"
echo "   - RAM: ${TOTAL_RAM_GB}GB"
echo "   - Disco: ${DISK_TOTAL}GB total, ${DISK_AVAILABLE}GB libre"
echo ""

# Configurar swap solo si es necesario (menos de 4GB RAM)
if [ "$TOTAL_RAM_GB" -lt 4 ]; then
    echo "💾 Configurando swap adicional..."
    sudo swapoff -a 2>/dev/null || true
    
    # Crear swap del doble de RAM si es menos de 4GB
    SWAP_SIZE=$((TOTAL_RAM_GB * 2))G
    sudo fallocate -l $SWAP_SIZE /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    
    echo "✅ Swap de ${SWAP_SIZE} creado"
else
    echo "✅ Suficiente RAM, no se necesita swap adicional"
fi

# ========== BUSCAR/DESCARGAR MAPA ==========
echo ""
echo "📥 ========================================="
echo "📥 CONFIGURACIÓN DEL MAPA"
echo "📥 ========================================="

# Buscar archivos PBF existentes
echo "Buscando archivos de mapa existentes..."

FOUND_PBFS=()
while IFS= read -r file; do
    if [ -n "$file" ]; then
        FOUND_PBFS+=("$file")
    fi
done < <(find ${TILE_DIR} /tmp /home/ubuntu -name "*.osm.pbf" -type f 2>/dev/null)

if [ ${#FOUND_PBFS[@]} -gt 0 ]; then
    echo "📋 Archivos encontrados:"
    for i in "${!FOUND_PBFS[@]}"; do
        SIZE=$(ls -lh "${FOUND_PBFS[$i]}" | awk '{print $5}')
        echo "   $((i+1)). ${FOUND_PBFS[$i]} ($SIZE)"
    done
    
    echo ""
    echo "Opciones:"
    echo "1. Usar archivo existente"
    echo "2. Descargar nuevo"
    echo ""
    echo -n "Selecciona (1-2): "
    read -r map_option
    
    if [ "$map_option" = "1" ]; then
        echo -n "Número del archivo a usar: "
        read -r file_num
        FILE_INDEX=$((file_num - 1))
        if [ "$file_num" -ge 1 ] && [ "$file_num" -le ${#FOUND_PBFS[@]} ]; then
            PBF_SOURCE="${FOUND_PBFS[$FILE_INDEX]}"
            echo "✅ Usando: $PBF_SOURCE"
        else
            echo "❌ Selección inválida, descargando nuevo..."
            PBF_SOURCE=""
        fi
    fi
fi

# Si no hay archivo o se eligió descargar
if [ -z "$PBF_SOURCE" ]; then
    echo ""
    echo "🗺️  SELECCIÓN DE MAPA:"
    echo "1. Colombia completo (descarga automática)"
    echo "2. Barranquilla específico (más rápido)"
    echo "3. Región personalizada (especificar bbox)"
    echo "4. Subir archivo propio (SCP/FTP)"
    echo ""
    echo -n "Selecciona una opción (1-4): "
    read -r region_option
    
    case $region_option in
        1)
            echo "📥 Descargando Colombia completo..."
            wget -O ${TILE_DIR}/colombia-latest.osm.pbf https://download.geofabrik.de/south-america/colombia-latest.osm.pbf
            PBF_SOURCE="${TILE_DIR}/colombia-latest.osm.pbf"
            ;;
        2)
            echo "📥 Descargando Barranquilla..."
            wget -O ${TILE_DIR}/barranquilla.osm.bz2 "https://overpass-api.de/api/map?bbox=-74.9,10.9,-74.7,11.1"
            echo "   Convirtiendo a PBF..."
            osmconvert ${TILE_DIR}/barranquilla.osm.bz2 -o=${TILE_DIR}/barranquilla.osm.pbf
            rm ${TILE_DIR}/barranquilla.osm.bz2
            PBF_SOURCE="${TILE_DIR}/barranquilla.osm.pbf"
            ;;
        3)
            echo "Ingresa los límites del bounding box:"
            read -p "Longitud mínima (oeste, ej: -74.9): " MIN_LON
            read -p "Latitud mínima (sur, ej: 10.9): " MIN_LAT
            read -p "Longitud máxima (este, ej: -74.7): " MAX_LON
            read -p "Latitud máxima (norte, ej: 11.1): " MAX_LAT
            
            echo "📥 Descargando región ${MIN_LON},${MIN_LAT},${MAX_LON},${MAX_LAT}..."
            wget -O ${TILE_DIR}/custom.osm.bz2 "https://overpass-api.de/api/map?bbox=${MIN_LON},${MIN_LAT},${MAX_LON},${MAX_LAT}"
            osmconvert ${TILE_DIR}/custom.osm.bz2 -o=${TILE_DIR}/custom.osm.pbf
            rm ${TILE_DIR}/custom.osm.bz2
            PBF_SOURCE="${TILE_DIR}/custom.osm.pbf"
            ;;
        4)
            echo "📤 Para subir tu archivo:"
            echo "   scp -i tu-clave.pem tu-archivo.osm.pbf ubuntu@$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):${TILE_DIR}/"
            echo ""
            echo "Esperando a que subas el archivo..."
            echo "Presiona ENTER cuando esté listo"
            read
            
            # Buscar archivos nuevos
            NEW_FILES=$(find ${TILE_DIR} -name "*.osm.pbf" -type f -newer ${TILE_DIR} 2>/dev/null || echo "")
            if [ -n "$NEW_FILES" ]; then
                PBF_SOURCE="$NEW_FILES"
            else
                echo "❌ No se encontró archivo nuevo"
                exit 1
            fi
            ;;
    esac
fi

# Copiar al nombre estándar
cp "$PBF_SOURCE" "${TILE_DIR}/map.osm.pbf"
TILE_PBF="${TILE_DIR}/map.osm.pbf"

# Mostrar información del mapa
echo ""
echo "📊 INFORMACIÓN DEL MAPA:"
PBF_SIZE=$(ls -lh ${TILE_PBF} | awk '{print $5}')
PBF_MB=$(ls -l ${TILE_PBF} | awk '{print $5}' | awk '{printf "%.0f", $1/1024/1024}')
echo "   - Tamaño: $PBF_SIZE"
echo "   - MB: ${PBF_MB}MB"
echo ""

# Estimar espacio necesario para tiles (regla: 10-20x tamaño PBF)
EST_TILES_GB=$(( (PBF_MB * 15) / 1024 ))
if [ "$EST_TILES_GB" -lt 5 ]; then
    EST_TILES_GB=5
fi

echo "⚠️  ESTIMACIÓN DE ESPACIO:"
echo "   - Los tiles pueden ocupar ~${EST_TILES_GB}GB"
echo "   - Espacio disponible: ${DISK_AVAILABLE}GB"

if [ "$DISK_AVAILABLE" -lt "$EST_TILES_GB" ]; then
    echo "❌ ESPACIO INSUFICIENTE estimado"
    echo "   Necesitas al menos ${EST_TILES_GB}GB libres"
    echo "   Libera espacio o monta un volumen EBS adicional"
    exit 1
fi

# ========== CREAR SCRIPT DE IMPORTACIÓN PARA c7i ==========
echo ""
echo "📝 Creando script de importación optimizado para c7i..."

cat > /tmp/optimized-import.sh << 'EOF'
#!/bin/bash
set -e

echo "📥 IMPORTACIÓN OPTIMIZADA PARA 4GB/2CPUs"
echo "   RAM: $(free -h | grep Mem | awk '{print $2}')"
echo "   CPUs: $(nproc)"
echo ""

# Configuración PostgreSQL para 4GB RAM
cat > /etc/postgresql/15/main/postgresql.conf << 'PGEOF'
# CONEXIONES
listen_addresses = 'localhost'
port = 5432
max_connections = 20

# MEMORIA - OPTIMIZADO PARA 4GB
shared_buffers = 1GB
work_mem = 16MB
maintenance_work_mem = 256MB
effective_cache_size = 2GB

# WRITE AHEAD LOG
wal_level = minimal
fsync = off
synchronous_commit = off
full_page_writes = off
wal_buffers = 16MB
checkpoint_timeout = 15min
max_wal_size = 2GB
min_wal_size = 1GB

# PARALELISMO (aprovechar 2 CPUs)
max_parallel_workers = 2
max_parallel_workers_per_gather = 2
PGEOF

# Configurar autenticación
cat > /etc/postgresql/15/main/pg_hba.conf << 'PGAUTH'
local   all             all                                     trust
host    all             all             127.0.0.1/32            trust
host    all             all             ::1/128                 trust
PGAUTH

# Iniciar PostgreSQL
echo "🔄 Iniciando PostgreSQL..."
service postgresql start
sleep 5

# Limpiar cache
echo 3 > /proc/sys/vm/drop_caches 2>/dev/null || true

# Ejecutar import con parámetros optimizados para 2 CPUs
echo "🚀 Ejecutando osm2pgsql con 2 procesos..."
echo "   ⏱️  Esto tomará aproximadamente: $(( $(ls -l /data/region.osm.pbf | awk '{print $5}') / 1024 / 1024 / 5 )) minutos"

sudo -u renderer osm2pgsql \
    --create \
    --slim \
    --cache 512 \
    --number-processes 2 \
    --style /home/renderer/src/openstreetmap-carto/openstreetmap-carto.style \
    --multi-geometry \
    --hstore-all \
    --tag-transform-script /home/renderer/src/openstreetmap-carto/openstreetmap-carto.lua \
    -d gis \
    -U renderer \
    -H /var/run/postgresql \
    /data/region.osm.pbf

IMPORT_EXIT=$?

if [ $IMPORT_EXIT -ne 0 ]; then
    echo "❌ Error en importación"
    tail -50 /var/log/postgresql/postgresql-15-main.log
    exit $IMPORT_EXIT
fi

echo "✅ Importación completada exitosamente"

# Optimizar base de datos
echo "📊 Optimizando base de datos..."
sudo -u postgres psql -d gis -c "VACUUM ANALYZE;"

# Crear índices completos
echo "🔧 Creando índices espaciales..."
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_polygon_way ON planet_osm_polygon USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_line_way ON planet_osm_line USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_point_way ON planet_osm_point USING gist(way);"
sudo -u postgres psql -d gis -c "CREATE INDEX IF NOT EXISTS idx_planet_osm_roads_way ON planet_osm_roads USING gist(way);"

echo "✅ IMPORTACIÓN COMPLETADA"
EOF

chmod +x /tmp/optimized-import.sh

# ========== IMPORTAR DATOS ==========
echo ""
echo "📥 ========================================="
echo "📥 INICIANDO IMPORTACIÓN"
echo "📥 ========================================="
echo "   ⏱️  Tiempo estimado: $(( PBF_MB / 5 )) minutos"
echo "   📊 Monitoreando..."
echo ""

# Crear volumen Docker
docker volume create ${TILE_VOLUME}

# Ejecutar import
docker run -d \
    --name tile-import \
    --memory=3g \
    --cpus=2 \
    -v ${TILE_PBF}:/data/region.osm.pbf:ro \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/optimized-import.sh:/tmp/optimized-import.sh:ro \
    --entrypoint /bin/bash \
    overv/openstreetmap-tile-server \
    -c 'bash /tmp/optimized-import.sh'

# Monitorear progreso
START_TIME=$(date +%s)
LAST_PERCENT=0

while docker ps -q -f name=tile-import | grep -q .; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    ELAPSED_MIN=$((ELAPSED / 60))
    
    # Mostrar progreso
    if [ $((ELAPSED % 30)) -eq 0 ]; then
        CURRENT_LOG=$(docker logs --tail 1 tile-import 2>&1)
        echo "[${ELAPSED_MIN}m] $CURRENT_LOG"
        
        # Mostrar uso de recursos cada 2 minutos
        if [ $((ELAPSED % 120)) -eq 0 ]; then
            docker stats --no-stream tile-import --format "   📊 CPU: {{.CPUPerc}} | RAM: {{.MemUsage}}"
        fi
    fi
    
    sleep 5
done

# Verificar resultado
IMPORT_EXIT=$(docker inspect tile-import --format='{{.State.ExitCode}}')
if [ "$IMPORT_EXIT" != "0" ]; then
    echo "❌ Error en importación (código: $IMPORT_EXIT)"
    docker logs --tail 50 tile-import
    exit 1
fi

docker rm tile-import
echo "✅ Importación completada en ${ELAPSED_MIN} minutos"

# ========== INICIAR SERVIDOR ==========
echo ""
echo "🚀 ========================================="
echo "🚀 INICIANDO SERVIDOR DE TILES"
echo "🚀 ========================================="

# Configuración optimizada para renderizado
cat > /tmp/renderd.conf << 'RENDERD'
[renderd]
socketname=/run/renderd/renderd.sock
num_threads=2
tile_dir=/var/lib/mod_tile
stats_file=/var/run/renderd/renderd.stats

[mapnik]
plugins_dir=/usr/lib/mapnik/3.0/input
font_dir=/usr/share/fonts/truetype
font_dir_recurse=true

[default]
URI=/tile/
TILEDIR=/var/lib/mod_tile
XML=/home/renderer/src/openstreetmap-carto/mapnik.xml
HOST=localhost
MINZOOM=0
MAXZOOM=18
TILESIZE=256
RENDERD

# Iniciar servidor
docker run -d \
    --name ${CONTAINER_NAME} \
    --restart unless-stopped \
    --memory=2g \
    --cpus=1.5 \
    -p 8080:80 \
    -p 5433:5432 \
    -v ${TILE_VOLUME}:/data/database/ \
    -v /tmp/renderd.conf:/etc/renderd.conf:ro \
    -e ALLOW_CORS=enabled \
    -e THREADS=2 \
    overv/openstreetmap-tile-server \
    run

# ========== CONFIGURAR SERVICIO ==========
echo ""
echo "🔧 Configurando servicio..."

sudo tee /etc/systemd/system/tileserver.service > /dev/null << EOF
[Unit]
Description=OpenStreetMap Tile Server
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
User=$(whoami)
Restart=always
RestartSec=10
ExecStartPre=-/usr/bin/docker stop ${CONTAINER_NAME}
ExecStartPre=-/usr/bin/docker rm ${CONTAINER_NAME}
ExecStart=/usr/bin/docker start -a ${CONTAINER_NAME}
ExecStop=/usr/bin/docker stop ${CONTAINER_NAME}

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable tileserver

# ========== SCRIPT DE MONITOREO ==========
cat > /home/ubuntu/monitor-tiles.sh << 'EOF'
#!/bin/bash
echo "📊 TILE SERVER - MONITOREO COMPLETO"
echo "===================================="
echo ""

# Contenedor
echo "🔍 ESTADO DEL CONTENEDOR:"
docker ps --filter "name=tile-server" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
echo ""

# Recursos
echo "📊 USO DE RECURSOS:"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" tile-server
echo ""

# Disco
echo "💾 ESPACIO EN DISCO:"
df -h /opt/tile-data /var/lib/docker | grep -v Filesystem
echo ""

# Tiles generados
echo "🗺️  ESTADÍSTICAS DE TILES:"
if docker exec tile-server test -d /var/lib/mod_tile/default 2>/dev/null; then
    TILE_COUNT=$(docker exec tile-server find /var/lib/mod_tile/default -type f -name "*.png" 2>/dev/null | wc -l)
    echo "   Tiles generados: $TILE_COUNT"
    
    # Últimos tiles
    echo "   Últimos 5 tiles:"
    docker exec tile-server ls -la /var/lib/mod_tile/default/ 2>/dev/null | tail -5 | awk '{print "   " $9 " (" $5 " bytes)"}'
else
    echo "   No hay tiles generados aún"
fi
echo ""

# Logs recientes
echo "📋 ÚLTIMOS LOGS:"
docker logs --tail 10 tile-server 2>&1
EOF

chmod +x /home/ubuntu/monitor-tiles.sh

# ========== VERIFICAR ==========
echo ""
echo "🔍 Verificando instalación..."

sleep 5
MAX_TRIES=30
for i in $(seq 1 $MAX_TRIES); do
    if curl -s -f -o /dev/null "http://localhost:8080/" 2>/dev/null; then
        echo "✅ Servidor web OK"
        
        # Probar tile
        if curl -s -f -o /tmp/test.png "http://localhost:8080/tile/0/0/0.png" 2>/dev/null; then
            echo "✅ Generación de tiles OK"
            break
        fi
    fi
    
    if [ $i -eq $MAX_TRIES ]; then
        echo "⚠️  El servidor no responde, revisa logs: docker logs tile-server"
    else
        echo "   Esperando... ($i/$MAX_TRIES)"
        sleep 5
    fi
done

# ========== RESUMEN ==========
echo ""
echo "========================================="
echo "🎉 TILE SERVER CONFIGURADO EN c7i.flex-large"
echo "========================================="
echo ""

PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "localhost")

echo "📊 CONFIGURACIÓN:"
echo "   - Instancia: c7i.flex-large (4GB RAM, 2 vCPUs)"
echo "   - Contenedor: ${CONTAINER_NAME}"
echo "   - Puerto tiles: 8080"
echo "   - Puerto PostGIS: 5433"
echo "   - Archivo mapa: ${TILE_PBF} ($PBF_SIZE)"
echo "   - Espacio disponible: ${DISK_AVAILABLE}GB"
echo "   - Log instalación: ${LOG_FILE}"
echo ""
echo "🔗 ENDPOINTS:"
echo "   - Servidor: http://${PUBLIC_IP}:8080"
echo "   - Tiles: http://${PUBLIC_IP}:8080/tile/{z}/{x}/{y}.png"
echo "   - PostGIS: postgresql://renderer@${PUBLIC_IP}:5433/gis"
echo ""
echo "📝 COMANDOS ÚTILES:"
echo "   - Ver estado: ./monitor-tiles.sh"
echo "   - Ver logs: docker logs -f tile-server"
echo "   - Entrar al contenedor: docker exec -it tile-server bash"
echo "   - Detener: docker stop tile-server"
echo "   - Iniciar: docker start tile-server"
echo "   - Reiniciar servicio: sudo systemctl restart tileserver"
echo ""
echo "🧪 PRUEBAS:"
echo "   curl -I http://localhost:8080/tile/13/4541/3633.png"
echo "   curl -o test.png http://localhost:8080/tile/0/0/0.png"
echo ""
echo "⚠️  NOTAS:"
echo "   - Los tiles se generan bajo demanda (caché)"
echo "   - El primer tile de cada zoom puede ser lento"
echo "   - Espacio estimado para tiles: ~${EST_TILES_GB}GB"
echo "   - Libre actual: ${DISK_AVAILABLE}GB"
echo ""
echo "========================================"