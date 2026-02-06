# app/services_buildings.py
from app.services_osrm import snap_to_road
from app.building_centroid import get_building_centroid  # tu archivo
from app.config import OSM_PBF_PATH

def recalculate_building(building_osm_id):
    # 1. Centroide del edificio
    lat, lon = get_building_centroid(OSM_PBF_PATH, building_osm_id)

    # 2. Snap to road
    snapped_lat, snapped_lon, segment_info = snap_to_road(lat, lon)

    if not segment_info:
        raise ValueError("No se pudo encontrar un segmento cercano")

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
