# app/services_osrm.py
import requests
import hashlib
from app.config import OSRM_HOST
import logging

log = logging.getLogger(__name__)

def reconstruct_segment_from_osrm(segment_id):
    """
    Intenta reconstruir un segmento usando OSRM.
    
    Como el segment_id es un hash de nodos y no tenemos los nodos originales,
    esta función no puede reconstruir el segmento exacto.
    
    Retorna None para que se use el fallback de estimación.
    """
    log.warning(f"⚠️ No se puede reconstruir segmento {segment_id} sin los nodos originales")
    return None

def get_street_segment_id(lat, lon, snapped_lat, snapped_lon):
    """
    Genera un ID único para el segmento de calle usando los nodos de OSRM.
    Los nodos son únicos por segmento de calle en la red vial.
    """
    try:
        # Usar /route con el mismo punto duplicado para obtener info del segmento
        url = f"{OSRM_HOST}/route/v1/driving/{lon},{lat};{lon},{lat}"
        response = requests.get(url, params={
            'steps': 'true',
            'annotations': 'true'
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
                        # Usar los nodos para crear el segment_id
                        # Los nodos son únicos por segmento en OSRM
                        node_pair = f"{min(nodes)}-{max(nodes)}"
                        segment_id = hashlib.md5(node_pair.encode()).hexdigest()[:12]
                        
                        # Obtener nombre de calle y bearing del primer step
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
                        
                        log.info(f"✓ Segment detectado: nodes={node_pair}, bearing={bearing}°")
                        
                        return {
                            'segment_id': segment_id,
                            'street_name': street_name,
                            'start_intersection': None,
                            'end_intersection': None,
                            'segment_length': legs[0].get('distance', 0),
                            'bearing': bearing,
                            'nodes': nodes  # Guardar los nodos para debug
                        }
        
        # Fallback: usar coordenadas redondeadas
        log.warning(f"⚠ Usando fallback para segment_id en ({lat}, {lon})")
        segment_string = f"{snapped_lat:.4f},{snapped_lon:.4f}"
        segment_id = hashlib.md5(segment_string.encode()).hexdigest()[:12]
        
        return {
            'segment_id': segment_id,
            'street_name': 'Unknown',
            'start_intersection': None,
            'end_intersection': None,
            'segment_length': 0,
            'bearing': 0
        }
        
    except Exception as e:
        log.error(f"Error obteniendo segment_id: {e}")
        # Fallback básico
        segment_string = f"{snapped_lat:.4f},{snapped_lon:.4f}"
        segment_id = hashlib.md5(segment_string.encode()).hexdigest()[:12]
        return {
            'segment_id': segment_id,
            'street_name': 'Unknown',
            'start_intersection': None,
            'end_intersection': None,
            'segment_length': 0,
            'bearing': 0
        }


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
                log.info(f"  Segmento: {segment_info['street_name']} | ID: {segment_info['segment_id']} | Ajuste: {distance:.2f}m")
                
                return snapped_lat, snapped_lon, segment_info
            else:
                log.warning(f"⚠ OSRM: No encontró calle cercana para ({lat:.6f}, {lon:.6f})")
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
        log.warning("⚠️ OSRM no disponible - snap-to-roads desactivado")
        return False