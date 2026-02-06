import requests
import time

def get_building_centroid(osm_pbf_path, building_osm_id):
    """
    Obtiene el centroide de un edificio desde OpenStreetMap API.
    
    Args:
        osm_pbf_path: No se usa (mantener por compatibilidad)
        building_osm_id: ID del edificio en OSM (way)
    
    Returns:
        (lat, lon): Tupla con coordenadas del centroide
    """
    
    # Consulta a Overpass API para obtener geometría del edificio
    overpass_url = "https://overpass-api.de/api/interpreter"
    
    # Query para obtener el edificio y sus nodos
    query = f"""
    [out:json][timeout:25];
    (
      way({building_osm_id});
    );
    out center;
    """
    
    try:
        print(f"🔍 Consultando OpenStreetMap para edificio {building_osm_id}...")
        
        response = requests.post(
            overpass_url,
            data={"data": query},
            timeout=30
        )
        
        if response.status_code != 200:
            raise ValueError(f"Error en Overpass API: HTTP {response.status_code}")
        
        data = response.json()
        
        if not data.get("elements"):
            raise ValueError(f"Edificio {building_osm_id} no encontrado en OpenStreetMap")
        
        element = data["elements"][0]
        
        # Verificar que tenga centroide
        if "center" not in element:
            raise ValueError(f"Edificio {building_osm_id} no tiene información de centroide")
        
        lat = element["center"]["lat"]
        lon = element["center"]["lon"]
        
        print(f"✅ Centroide obtenido: ({lat}, {lon})")
        
        return (lat, lon)
        
    except requests.exceptions.Timeout:
        raise ValueError(f"Timeout consultando Overpass API para edificio {building_osm_id}")
    
    except requests.exceptions.RequestException as e:
        raise ValueError(f"Error de red consultando Overpass API: {str(e)}")
    
    except KeyError as e:
        raise ValueError(f"Respuesta inesperada de Overpass API: {str(e)}")


def get_building_centroid_cached(osm_pbf_path, building_osm_id):
    """
    Versión con caché para evitar consultas repetidas.
    Puedes implementar Redis o un diccionario en memoria.
    """
    # TODO: Implementar caché si es necesario
    return get_building_centroid(osm_pbf_path, building_osm_id)