# app/services/services_buildings.py
from app.services_osrm import snap_to_road
from app.geo.building_centroid import get_building_centroid
from app.config import OSM_PBF_PATH

def recalculate_building(building_osm_id):
    # 1. Centroide del edificio
    lat, lon = get_building_centroid(OSM_PBF_PATH, building_osm_id)
    
    # ✅ VALIDAR que las coordenadas existen
    if lat is None or lon is None:
        raise ValueError(f"No se pudo obtener coordenadas del edificio {building_osm_id}")

    # 2. Snap to road
    snapped_lat, snapped_lon, segment_info = snap_to_road(lat, lon)

    if not segment_info:
        raise ValueError("No se pudo encontrar un segmento cercano")
    
    # ✅ VALIDAR que las coordenadas snapped existen
    if snapped_lat is None or snapped_lon is None:
        raise ValueError("No se pudieron obtener coordenadas ajustadas")

    return {
        "osm_id": building_osm_id,
        "centroid": {
            "lat": lat,
            "lon": lon
        },
        "road": {
            "segment_id": segment_info["segment_id"],
            "street_name": segment_info.get("street_name"),
            "snapped_lat": snapped_lat,
            "snapped_lon": snapped_lon
        }
    }
