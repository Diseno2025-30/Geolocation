# app/services_osrm.py
import requests
import hashlib
from app.config import OSRM_HOST
import logging

log = logging.getLogger(__name__)

def get_street_segment_id(lat, lon, snapped_lat, snapped_lon):
    """
    Genera un ID único para el segmento de calle basado en:
    - Coordenadas ajustadas
    - Calles adyacentes (intersecciones)
    
    Retorna un dict con información del segmento.
    """
    try:
        # 1. Obtener información de la vía usando OSRM Match API
        # Esto nos da el segmento específico de la red vial
        url = f"{OSRM_HOST}/match/v1/driving/{lon},{lat}"
        response = requests.get(url, params={
            'overview': 'full',
            'geometries': 'geojson',
            'steps': 'true',
            'annotations': 'true'
        }, timeout=2)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok' and len(data.get('matchings', [])) > 0:
                matching = data['matchings'][0]
                
                # Extraer información del segmento
                legs = matching.get('legs', [])
                if legs and len(legs) > 0:
                    steps = legs[0].get('steps', [])
                    if steps and len(steps) > 0:
                        step = steps[0]
                        
                        # Obtener nombre de la calle
                        street_name = step.get('name', 'Unknown')
                        
                        # Obtener intersecciones (inicio y fin del segmento)
                        intersections = step.get('intersections', [])
                        
                        if len(intersections) >= 2:
                            # Primera y última intersección definen el segmento
                            start_intersection = intersections[0]['location']
                            end_intersection = intersections[-1]['location']
                            
                            # Crear ID único del segmento
                            segment_string = f"{street_name}|{start_intersection[0]:.5f},{start_intersection[1]:.5f}|{end_intersection[0]:.5f},{end_intersection[1]:.5f}"
                            segment_id = hashlib.md5(segment_string.encode()).hexdigest()[:12]
                            
                            return {
                                'segment_id': segment_id,
                                'street_name': street_name,
                                'start_intersection': start_intersection,
                                'end_intersection': end_intersection,
                                'segment_length': step.get('distance', 0),
                                'bearing': intersections[0].get('bearings', [0])[0] if intersections else 0
                            }
        
        # Fallback: usar coordenadas redondeadas si no hay información detallada
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