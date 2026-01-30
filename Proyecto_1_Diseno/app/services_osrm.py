# app/services_osrm.py
import requests
import hashlib
import polyline  # pip install polyline
from app.config import OSRM_HOST
import logging

log = logging.getLogger(__name__)

def get_street_segment_id(lat, lon, snapped_lat, snapped_lon):
    """
    Genera un ID único para el segmento de calle usando los nodos de OSRM.
    IMPORTANTE: Ahora también retorna los nodos originales para poder reconstruir.
    """
    try:
        url = f"{OSRM_HOST}/route/v1/driving/{lon},{lat};{lon},{lat}"
        response = requests.get(url, params={
            'steps': 'true',
            'annotations': 'true',
            'geometries': 'polyline'  # ← IMPORTANTE para obtener geometría
        }, timeout=2)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok' and len(data.get('routes', [])) > 0:
                route = data['routes'][0]
                legs = route.get('legs', [])
                
                if legs and len(legs) > 0:
                    annotation = legs[0].get('annotation', {})
                    nodes = annotation.get('nodes', [])
                    steps = legs[0].get('steps', [])
                    
                    if nodes and len(nodes) >= 2:
                        # Crear segment_id usando los nodos
                        node_pair = f"{min(nodes)}-{max(nodes)}"
                        segment_id = hashlib.md5(node_pair.encode()).hexdigest()[:12]
                        
                        # Obtener nombre de calle y bearing
                        street_name = 'Unknown'
                        bearing = 0
                        
                        if steps and len(steps) > 0:
                            step = steps[0]
                            street_name = step.get('name', 'Unknown') or 'Unknown'
                            intersections = step.get('intersections', [])
                            if intersections:
                                bearings = intersections[0].get('bearings', [])
                                if bearings:
                                    bearing = bearings[0]
                        
                        log.info(f"✓ Segment: {street_name} | ID: {segment_id} | Nodos: {node_pair}")
                        
                        return {
                            'segment_id': segment_id,
                            'street_name': street_name,
                            'segment_length': legs[0].get('distance', 0),
                            'bearing': bearing,
                            'nodes': nodes,  # ← GUARDAR NODOS ORIGINALES
                            'osrm_nodes': node_pair  # ← GUARDAR TAMBIÉN COMO STRING
                        }
        
        # Fallback
        log.warning(f"⚠ Usando fallback para segment_id en ({lat}, {lon})")
        segment_string = f"{snapped_lat:.4f},{snapped_lon:.4f}"
        segment_id = hashlib.md5(segment_string.encode()).hexdigest()[:12]
        
        return {
            'segment_id': segment_id,
            'street_name': 'Unknown',
            'segment_length': 0,
            'bearing': 0,
            'nodes': [],
            'osrm_nodes': None
        }
        
    except Exception as e:
        log.error(f"Error obteniendo segment_id: {e}")
        segment_string = f"{snapped_lat:.4f},{snapped_lon:.4f}"
        segment_id = hashlib.md5(segment_string.encode()).hexdigest()[:12]
        return {
            'segment_id': segment_id,
            'street_name': 'Unknown',
            'segment_length': 0,
            'bearing': 0,
            'nodes': [],
            'osrm_nodes': None
        }


def get_segment_geometry_from_osrm(node_pair):
    """
    Obtiene la geometría REAL de un segmento usando OSRM Route API.
    
    Args:
        node_pair: String como "12345-67890" con los nodos OSRM
        
    Returns:
        Lista de coordenadas [lat, lon] que forman la geometría del segmento
    """
    try:
        # Parsear los nodos
        nodes = node_pair.split('-')
        if len(nodes) != 2:
            log.error(f"❌ node_pair inválido: {node_pair}")
            return None
        
        # IMPORTANTE: OSRM necesita coordenadas, no IDs de nodos directamente
        # Como solo tenemos los IDs, necesitamos otra estrategia
        
        log.warning(f"⚠️ No se puede obtener geometría directamente de node_pair: {node_pair}")
        log.warning(f"   OSRM Route API requiere coordenadas lat/lon, no IDs de nodos")
        
        return None
        
    except Exception as e:
        log.error(f"❌ Error obteniendo geometría de OSRM: {e}")
        return None


def get_route_geometry_between_points(coordinates):
    """
    Obtiene la geometría de ruta entre múltiples puntos usando OSRM Route API.
    
    Args:
        coordinates: Lista de diccionarios [{'lat': ..., 'lon': ...}, ...]
        
    Returns:
        Lista de coordenadas [lat, lon] que siguen el callejero
    """
    try:
        if not coordinates or len(coordinates) < 2:
            log.warning("⚠️ Se necesitan al menos 2 coordenadas")
            return []
        
        # Construir string de coordenadas para OSRM: "lon,lat;lon,lat;..."
        coords_str = ";".join([f"{c['lon']},{c['lat']}" for c in coordinates])
        
        url = f"{OSRM_HOST}/route/v1/driving/{coords_str}"
        response = requests.get(url, params={
            'overview': 'full',  # Geometría completa
            'geometries': 'polyline',  # Formato polyline (compacto)
            'steps': 'false'  # No necesitamos steps
        }, timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            
            if data.get('code') == 'Ok' and len(data.get('routes', [])) > 0:
                route = data['routes'][0]
                geometry_encoded = route.get('geometry')
                
                if geometry_encoded:
                    # Decodificar polyline de OSRM
                    decoded = polyline.decode(geometry_encoded)
                    
                    log.info(f"✅ Geometría obtenida: {len(decoded)} puntos siguiendo el callejero")
                    
                    # Convertir a formato [lat, lon]
                    return [[lat, lon] for lat, lon in decoded]
        
        log.warning(f"⚠️ OSRM no devolvió geometría válida")
        return []
        
    except Exception as e:
        log.error(f"❌ Error obteniendo geometría de ruta: {e}")
        import traceback
        log.error(traceback.format_exc())
        return []


def snap_to_road(lat, lon):
    """
    Ajusta coordenadas GPS a la calle más cercana y retorna información del segmento.
    Retorna: (lat, lon, segment_info)
    """
    try:
        url = f"{OSRM_HOST}/nearest/v1/driving/{lon},{lat}"
        response = requests.get(url, params={'number': 1}, timeout=2)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok' and len(data.get('waypoints', [])) > 0:
                snapped_location = data['waypoints'][0]['location']
                snapped_lon = snapped_location[0]
                snapped_lat = snapped_location[1]
                distance = data['waypoints'][0].get('distance', 0)
                
                # Obtener información del segmento de calle
                segment_info = get_street_segment_id(lat, lon, snapped_lat, snapped_lon)
                
                log.info(f"✓ Snap-to-road: ({lat:.6f}, {lon:.6f}) → ({snapped_lat:.6f}, {snapped_lon:.6f})")
                log.info(f"  Segmento: {segment_info['street_name']} | ID: {segment_info['segment_id']}")
                
                return snapped_lat, snapped_lon, segment_info
            else:
                log.warning(f"⚠ OSRM: No encontró calle cercana")
                return lat, lon, None
        else:
            log.warning(f"⚠ OSRM HTTP error {response.status_code}")
            return lat, lon, None
            
    except requests.exceptions.RequestException as e:
        log.warning(f"⚠ Error de conexión OSRM: {e}")
        return lat, lon, None
    except Exception as e:
        log.error(f"⚠ Error en snap_to_road: {e}")
        return lat, lon, None


def check_osrm_available():
    """Verifica si OSRM está disponible."""
    try:
        response = requests.get(f"{OSRM_HOST}/nearest/v1/driving/-74.8,11.0", timeout=2)
        if response.status_code == 200:
            log.info("✅ OSRM disponible")
            return True
        else:
            log.warning("⚠️ OSRM responde pero con error")
            return False
    except requests.exceptions.RequestException:
        log.warning("⚠️ OSRM no disponible")
        return False