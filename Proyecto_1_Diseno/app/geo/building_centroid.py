import psycopg2
import logging

log = logging.getLogger(__name__)


def _get_centroid_from_postgis(building_osm_id):
    """
    Obtiene el centroide de un edificio desde PostGIS local (tile server).
    Retorna (lat, lon) o None si no se encuentra.
    """
    try:
        from app.config import (
            TILESERVER_DB_HOST, TILESERVER_DB_PORT,
            TILESERVER_DB_NAME, TILESERVER_DB_USER, TILESERVER_DB_PASSWORD
        )

        conn = psycopg2.connect(
            host=TILESERVER_DB_HOST,
            port=TILESERVER_DB_PORT,
            dbname=TILESERVER_DB_NAME,
            user=TILESERVER_DB_USER,
            password=TILESERVER_DB_PASSWORD,
            connect_timeout=5
        )
        cur = conn.cursor()

        # planet_polygon almacena ways con geometría en proyección 3857 (Web Mercator)
        # Transformamos a 4326 (lat/lon) para obtener coordenadas reales
        cur.execute("""
            SELECT
                ST_Y(ST_Centroid(ST_Transform(way, 4326))),
                ST_X(ST_Centroid(ST_Transform(way, 4326)))
            FROM planet_polygon
            WHERE osm_id = %s
            LIMIT 1
        """, (building_osm_id,))

        row = cur.fetchone()
        cur.close()
        conn.close()

        if row and row[0] is not None:
            lat, lon = row[0], row[1]
            log.info(f"✅ Centroide desde PostGIS local: edificio {building_osm_id} → ({lat}, {lon})")
            return (lat, lon)

        return None

    except Exception as e:
        log.warning(f"⚠️ PostGIS local no disponible: {e}")
        return None


def get_building_centroid(osm_pbf_path, building_osm_id):
    """
    Obtiene el centroide de un edificio desde PostGIS local.

    Args:
        osm_pbf_path: Ruta al PBF (mantenido por compatibilidad)
        building_osm_id: ID del edificio en OSM (way)

    Returns:
        (lat, lon): Tupla con coordenadas del centroide, o (None, None) si no se encuentra.
    """
    result = _get_centroid_from_postgis(building_osm_id)
    if result:
        return result

    log.warning(f"❌ Edificio {building_osm_id} no encontrado en PostGIS local")
    return (None, None)


def get_building_centroid_cached(osm_pbf_path, building_osm_id):
    """
    Versión con caché para evitar consultas repetidas.
    """
    # TODO: Implementar caché si es necesario
    return get_building_centroid(osm_pbf_path, building_osm_id)
