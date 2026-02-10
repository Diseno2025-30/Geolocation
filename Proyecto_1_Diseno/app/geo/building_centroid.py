import requests
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

        # planet_osm_polygon almacena ways con geometría en proyección 3857 (Web Mercator)
        # Transformamos a 4326 (lat/lon) para obtener coordenadas reales
        cur.execute("""
            SELECT
                ST_Y(ST_Centroid(ST_Transform(way, 4326))),
                ST_X(ST_Centroid(ST_Transform(way, 4326)))
            FROM planet_osm_polygon
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


def _get_centroid_from_overpass(building_osm_id):
    """
    Obtiene el centroide de un edificio desde Overpass API (fallback externo).
    Retorna (lat, lon) o lanza ValueError.
    """
    overpass_url = "https://overpass-api.de/api/interpreter"

    query = f"""
    [out:json][timeout:25];
    (
      way({building_osm_id});
    );
    out center;
    """

    log.info(f"🌐 Consultando Overpass API para edificio {building_osm_id} (fallback)...")

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

    if "center" not in element:
        raise ValueError(f"Edificio {building_osm_id} no tiene información de centroide")

    lat = element["center"]["lat"]
    lon = element["center"]["lon"]

    log.info(f"✅ Centroide desde Overpass API: ({lat}, {lon})")

    return (lat, lon)


def get_building_centroid(osm_pbf_path, building_osm_id):
    """
    Obtiene el centroide de un edificio.
    Intenta primero PostGIS local (tile server), fallback a Overpass API.

    Args:
        osm_pbf_path: Ruta al PBF (mantenido por compatibilidad)
        building_osm_id: ID del edificio en OSM (way)

    Returns:
        (lat, lon): Tupla con coordenadas del centroide
    """

    # Intentar PostGIS local primero (rápido, privado, sin internet)
    result = _get_centroid_from_postgis(building_osm_id)
    if result:
        return result

    # Fallback a Overpass API (internet, público)
    log.info(f"📡 PostGIS local no tiene edificio {building_osm_id}, usando Overpass API...")
    return _get_centroid_from_overpass(building_osm_id)


def get_building_centroid_cached(osm_pbf_path, building_osm_id):
    """
    Versión con caché para evitar consultas repetidas.
    """
    # TODO: Implementar caché si es necesario
    return get_building_centroid(osm_pbf_path, building_osm_id)
