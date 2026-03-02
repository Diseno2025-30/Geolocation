#!/bin/bash

echo "🔍 DIAGNÓSTICO DE ESPACIO PARA TILE SERVER"
echo "==========================================="
echo ""

# ========== 1. VER ESPACIO EN DISCO ==========
echo "📊 ESPACIO EN DISCO:"
df -h | grep -E "Filesystem|/$|/var|/opt|/home"
echo ""

# ========== 2. VER TAMAÑO DE DIRECTORIOS ==========
echo "📁 DIRECTORIOS GRANDES:"
sudo du -sh /* 2>/dev/null | sort -hr | head -10
echo ""

# ========== 3. VER TAMAÑO DE DOCKER ==========
echo "🐳 ESPACIO DE DOCKER:"
sudo du -sh /var/lib/docker 2>/dev/null || echo "Docker no instalado"
sudo du -sh /var/lib/docker/volumes 2>/dev/null || echo "No hay volúmenes"
echo ""

# ========== 4. VER VOLÚMENES DOCKER ==========
echo "💿 VOLÚMENES DOCKER:"
docker volume ls
echo ""
echo "TAMAÑO DE VOLÚMENES:"
for vol in $(docker volume ls -q); do
    sudo du -sh /var/lib/docker/volumes/$vol 2>/dev/null | awk -v vol=$vol '{print "  " vol ": " $1}'
done
echo ""

# ========== 5. VER ARCHIVOS PBF ==========
echo "🗺️  ARCHIVOS PBF:"
find / -name "*.osm.pbf" -type f -exec ls -lh {} \; 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# ========== 6. VER CONTENEDORES TILE ==========
echo "🔄 CONTENEDORES TILE:"
docker ps -a --filter "name=tile" --format "table {{.Names}}\t{{.Status}}\t{{.Size}}"
echo ""

# ========== 7. VER LOGS GRANDES ==========
echo "📋 LOGS GRANDES:"
sudo find /var/log -type f -size +50M -exec ls -lh {} \; 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""

# ========== 8. RECOMENDACIONES ==========
echo "💡 RECOMENDACIONES:"
echo "1. Si el PBF es solo 6.6MB, deberías tener suficiente espacio"
echo "2. Lo más probable es que haya volúmenes Docker antiguos ocupando espacio"
echo "3. También puede haber imágenes Docker viejas"
echo ""

# ========== 9. OFRECER LIMPIEZA ==========
echo "¿QUIERES LIMPIAR? Opciones:"
echo "1. Limpieza suave (solo contenedores detenidos)"
echo "2. Limpieza media + volúmenes huérfanos"
echo "3. Limpieza agresiva (TODO lo de tiles)"
echo "4. Salir sin limpiar"
echo ""
read -p "Selecciona (1-4): " clean_option

case $clean_option in
    1)
        echo "🧹 Limpieza suave..."
        docker container prune -f
        docker image prune -f
        ;;
    2)
        echo "🧹 Limpieza media..."
        docker container prune -f
        docker image prune -f
        docker volume prune -f
        ;;
    3)
        echo "🧹 LIMPIEZA AGRESIVA..."
        # Detener todo lo de tiles
        docker stop $(docker ps -a -q --filter "name=tile") 2>/dev/null || true
        docker rm -f $(docker ps -a -q --filter "name=tile") 2>/dev/null || true
        
        # Eliminar volúmenes de tiles
        for vol in $(docker volume ls -q | grep -E "tile|openstreet|osm"); do
            echo "   Eliminando volumen: $vol"
            docker volume rm $vol 2>/dev/null || true
        done
        
        # Eliminar imágenes de tiles
        docker rmi $(docker images overv/openstreetmap-tile-server -q) 2>/dev/null || true
        
        # Limpiar todo
        docker system prune -a -f --volumes
        
        # Eliminar archivos PBF temporales
        sudo find / -name "*.osm.pbf" -type f -exec rm -f {} \; 2>/dev/null || true
        sudo rm -rf /opt/tile-data/*
        sudo rm -rf /tmp/*.osm.pbf
        
        echo "✅ Limpieza completada"
        ;;
    *)
        echo "Saliendo sin limpiar"
        exit 0
        ;;
esac

# ========== 10. MOSTRAR ESPACIO LIBERADO ==========
echo ""
echo "📊 ESPACIO DESPUÉS DE LIMPIEZA:"
df -h /