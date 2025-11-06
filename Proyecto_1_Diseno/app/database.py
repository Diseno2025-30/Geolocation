# app/database.py
import psycopg2
from app.config import DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

def get_db():
    """Establece una nueva conexión a la base de datos."""
    conn = psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    return conn

def create_table():
    """
    Crea la tabla 'coordinates' si no existe.
    user_id ahora es TEXT para almacenar el número de cédula directamente.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS coordinates (
            id serial PRIMARY KEY,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            timestamp TEXT NOT NULL,
            source TEXT NOT NULL,
            user_id TEXT
        )
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_coordinates_user_id
        ON coordinates(user_id);
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_coordinates_timestamp
        ON coordinates(timestamp);
    ''')
    
    conn.commit()
    conn.close()
    log.info("✓ Tabla 'coordinates' verificada/creada")

def insert_coordinate(lat, lon, timestamp, source, user_id=None):
    """
    Inserta una nueva coordenada en la base de datos.
    user_id es ahora un string (número de cédula).
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO coordinates (lat, lon, timestamp, source, user_id) VALUES (%s, %s, %s, %s, %s)",
            (lat, lon, timestamp, source, user_id)
        )
        conn.commit()
        conn.close()
        log.info(f"✓ Guardado en BD: {lat:.6f}, {lon:.6f} (Fuente: {source}, UserID: {user_id})")
    except Exception as e:
        log.error(f"Error al insertar en BD: {e}")

def get_last_coordinate():
    """Obtiene la última coordenada registrada."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 1")
    data = cursor.fetchone()
    conn.close()

    if data:
        column_names = ['id', 'lat', 'lon', 'timestamp', 'source', 'user_id']
        return dict(zip(column_names, data))
    return {}

def get_latest_db_records(limit=20):
    """Obtiene los últimos N registros para la vista de base de datos."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT %s", (limit,))
    data = cursor.fetchall()
    column_names = ['id', 'lat', 'lon', 'timestamp', 'source', 'user_id']
    results = [dict(zip(column_names, row)) for row in data]
    conn.close()
    return results

def get_historical_by_date(fecha_formateada, user_id=None):
    """Obtiene datos históricos por fecha (formato DD/MM/YYYY)."""
    conn = get_db()
    cursor = conn.cursor()
    
    query = "SELECT lat, lon, timestamp FROM coordinates WHERE timestamp LIKE %s"
    params = [f"{fecha_formateada}%"]
    
    if user_id:
        query += " AND user_id = %s"
        params.append(str(user_id))
        
    query += " ORDER BY timestamp"
    
    cursor.execute(query, tuple(params))
    results = cursor.fetchall()
    conn.close()
    
    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    log.info(f"Consulta histórica: {fecha_formateada} (User: {user_id}) - {len(coordenadas)} registros")
    return coordenadas

def get_historical_by_range(start_datetime, end_datetime, user_id=None):
    """Obtiene datos históricos por rango de datetime (optimizado)."""
    conn = get_db()
    cursor = conn.cursor()
    
    query_base = """
        SELECT DISTINCT 
            lat, 
            lon, 
            timestamp, 
            TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') AS ts_orden
        FROM coordinates
        WHERE TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS')
              BETWEEN %s AND %s
    """
    params = [start_datetime, end_datetime]
    
    if user_id:
        query_base += " AND user_id = %s"
        params.append(str(user_id))
        
    query = query_base + " ORDER BY ts_orden LIMIT 50000;"
    
    cursor.execute(query, tuple(params))
    results = cursor.fetchall()
    conn.close()
    
    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    log.info(f"Consulta optimizada: {start_datetime} a {end_datetime} (User: {user_id}) - {len(coordenadas)} registros")
    return coordenadas

def get_historical_by_geofence(min_lat, max_lat, min_lon, max_lon, user_id=None):
    """Obtiene datos históricos por geocerca (bounds)."""
    conn = get_db()
    cursor = conn.cursor()
    
    query_base = """
        SELECT DISTINCT 
            lat, 
            lon, 
            timestamp,
            TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') AS ts_orden
        FROM coordinates
        WHERE (lat BETWEEN %s AND %s)
          AND (lon BETWEEN %s AND %s)
    """
    params = [min_lat, max_lat, min_lon, max_lon]
    
    if user_id:
        query_base += " AND user_id = %s"
        params.append(str(user_id))
        
    query = query_base + " ORDER BY ts_orden LIMIT 50000;"
    
    cursor.execute(query, tuple(params))
    results = cursor.fetchall()
    conn.close()
    
    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    log.info(f"Consulta por Geocerca (User: {user_id}): {len(coordenadas)} registros encontrados")
    return coordenadas

def get_active_devices():
    """
    Obtiene dispositivos activos (últimos 5 minutos).
    Retorna lista de tuplas (user_id, source, timestamp)
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        WITH latest_per_user AS (
            SELECT 
                user_id,
                MAX(TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS')) as max_timestamp
            FROM coordinates
            WHERE user_id IS NOT NULL
              AND TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') >= NOW() - INTERVAL '5 minutes'
            GROUP BY user_id
        )
        SELECT DISTINCT c.user_id, c.source, c.timestamp
        FROM coordinates c
        INNER JOIN latest_per_user lpu 
            ON c.user_id = lpu.user_id 
            AND TO_TIMESTAMP(c.timestamp, 'DD/MM/YYYY HH24:MI:SS') = lpu.max_timestamp
        ORDER BY c.timestamp DESC
    ''')
    
    results = cursor.fetchall()
    conn.close()
    
    log.info(f"Dispositivos activos encontrados: {len(results)}")
    return results