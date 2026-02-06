import osmium
import math

class BuildingCentroidHandler(osmium.SimpleHandler):
    def __init__(self, target_way_id):
        super().__init__()
        self.target_way_id = int(target_way_id)
        self.coords = []

    def way(self, w):
        if w.id == self.target_way_id:
            for n in w.nodes:
                if n.location.valid():
                    self.coords.append((n.location.lat, n.location.lon))


def calculate_centroid(coords):
    """
    Calcula centroide simple (promedio).
    Suficiente para edificios.
    """
    if not coords:
        return None

    lat_sum = sum(c[0] for c in coords)
    lon_sum = sum(c[1] for c in coords)

    return (
        lat_sum / len(coords),
        lon_sum / len(coords)
    )


def get_building_centroid(osm_pbf_path, building_osm_id):
    """
    Retorna (lat, lon) del centroide del edificio
    """
    handler = BuildingCentroidHandler(building_osm_id)
    handler.apply_file(osm_pbf_path, locations=True)

    if not handler.coords:
        raise ValueError(f"No se encontraron nodos para el edificio {building_osm_id}")

    return calculate_centroid(handler.coords)
