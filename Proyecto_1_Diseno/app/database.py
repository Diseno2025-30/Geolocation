# app/database.py
import psycopg2
from app.config import DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
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

def migrate_add_segment_fields():
    """
    Migración para agregar campos de segmentación a tablas existentes.
    Ejecutar una sola vez si la tabla ya existe.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Verificar si las columnas ya existen
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='coordinates' AND column_name='segment_id'
        """)
        
        if cursor.fetchone() is None:
            log.info("🔄 Agregando campos de segmentación a tabla existente...")
            
            cursor.execute("ALTER TABLE coordinates ADD COLUMN segment_id TEXT DEFAULT NULL")
            cursor.execute("ALTER TABLE coordinates ADD COLUMN street_name TEXT DEFAULT 'Unknown'")
            cursor.execute("ALTER TABLE coordinates ADD COLUMN segment_length REAL DEFAULT 0")
            cursor.execute("ALTER TABLE coordinates ADD COLUMN bearing INTEGER DEFAULT 0")
            
            cursor.execute("CREATE INDEX idx_coordinates_segment_id ON coordinates(segment_id)")
            cursor.execute("CREATE INDEX idx_coordinates_street_name ON coordinates(street_name)")
            
            conn.commit()
            log.info("✅ Migración completada exitosamente")
        else:
            log.info("✓ Campos de segmentación ya existen")
        
        conn.close()
    except Exception as e:
        log.error(f"❌ Error en migración: {e}")
        raise

def create_destinations_table():
    """Crea la tabla destinations si no existe."""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS destinations (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(50) NOT NULL,
            latitude DECIMAL(10, 8) NOT NULL,
            longitude DECIMAL(11, 8) NOT NULL,
            status VARCHAR(20) DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delivered_at TIMESTAMP NULL
        )
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_destinations_user_id 
        ON destinations(user_id)
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_destinations_created_at 
        ON destinations(created_at)
    ''')
    
    conn.commit()
    conn.close()
    log.info("✓ Tabla 'destinations' verificada/creada")


def insert_coordinate(lat, lon, timestamp, source, user_id=None, 
                     segment_id=None, street_name='Unknown', 
                     segment_length=0, bearing=0):
    """
    Inserta una nueva coordenada en la base de datos con información de segmento.
    Todos los campos de segmentación son opcionales con valores por defecto.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO coordinates 
            (lat, lon, timestamp, source, user_id, segment_id, street_name, segment_length, bearing) 
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (lat, lon, timestamp, source, user_id, segment_id, street_name, segment_length, bearing)
        )
        conn.commit()
        conn.close()
        
        segment_info = f"Segmento: {street_name} [{segment_id}]" if segment_id else "Sin segmento"
        log.info(f"✓ Guardado en BD: {lat:.6f}, {lon:.6f} | UserID: {user_id} | {segment_info}")
    except Exception as e:
        log.error(f"❌ Error al insertar en BD: {e}")
        raise

def get_congestion_segments(time_window_seconds):
    """
    Detecta congestión: 2+ vehículos en el mismo segmento.
    Retorna lista de segmentos congestionados con coordenadas de los vehículos.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("SET TIME ZONE 'America/Bogota'")
        
        # Query que incluye las coordenadas de todos los vehículos en el segmento
        query = f"""
            WITH recent_positions AS (
                SELECT DISTINCT ON (user_id)
                    user_id,
                    lat,
                    lon,
                    segment_id,
                    street_name,
                    timestamp
                FROM coordinates
                WHERE segment_id IS NOT NULL
                  AND TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') 
                      >= NOW() - INTERVAL '{time_window_seconds} seconds'
                ORDER BY user_id, TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') DESC
            )
            SELECT 
                segment_id,
                street_name,
                COUNT(DISTINCT user_id) as vehicle_count,
                ARRAY_AGG(DISTINCT user_id) as vehicle_ids,
                AVG(lat) as center_lat,
                AVG(lon) as center_lon,
                ARRAY_AGG(ARRAY[lat, lon]) as segment_coords
            FROM recent_positions
            WHERE segment_id IS NOT NULL
            GROUP BY segment_id, street_name
            HAVING COUNT(DISTINCT user_id) >= 2
            ORDER BY vehicle_count DESC
        """
        
        cursor.execute(query)
        results = cursor.fetchall()
        conn.close()
        
        congestion = []
        for row in results:
            # Convertir coordenadas PostgreSQL a lista Python
            segment_coords = []
            if row[6]:  # row[6] es el ARRAY de coordenadas
                for coord in row[6]:
                    segment_coords.append([float(coord[0]), float(coord[1])])
            
            congestion.append({
                'segment_id': row[0],
                'street_name': row[1],
                'vehicle_count': row[2],
                'vehicle_ids': row[3],
                'center_lat': float(row[4]),
                'center_lon': float(row[5]),
                'segment_coords': segment_coords 
            })
        
        log.info(f"🚦 {len(congestion)} segmentos con congestión detectados")
        return congestion
        
    except Exception as e:
        log.error(f"❌ Error detectando congestión: {e}")
        import traceback
        log.error(traceback.format_exc())
        return []
        
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

def get_historical_by_range(start_datetime, end_datetime, user_id=None, user_ids=None):
    """
    Obtiene datos históricos por rango de datetime (optimizado).
    Acepta user_id (single) o user_ids (lista) para múltiples usuarios.
    """
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

    # Priorizar user_ids sobre user_id
    if user_ids and len(user_ids) > 0:
        placeholders = ','.join(['%s'] * len(user_ids))
        query_base += f" AND user_id IN ({placeholders})"
        params.extend([str(uid) for uid in user_ids])
        user_filter_msg = f"Users: {user_ids}"
    elif user_id:
        query_base += " AND user_id = %s"
        params.append(str(user_id))
        user_filter_msg = f"User: {user_id}"
    else:
        user_filter_msg = "All users"

    query = query_base + " ORDER BY ts_orden LIMIT 50000;"

    cursor.execute(query, tuple(params))
    results = cursor.fetchall()
    conn.close()

    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    log.info(f"Consulta optimizada: {start_datetime} a {end_datetime} ({user_filter_msg}) - {len(coordenadas)} registros")
    return coordenadas

def get_historical_by_geofence(min_lat, max_lat, min_lon, max_lon, user_id=None, user_ids=None, start_datetime=None, end_datetime=None):
    """
    Obtiene datos históricos por geocerca (bounds).
    Acepta user_id (single) o user_ids (lista) para múltiples usuarios.
    Opcionalmente filtra por rango de tiempo.
    """
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

    # Filtro de tiempo opcional
    if start_datetime and end_datetime:
        query_base += " AND TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') BETWEEN %s AND %s"
        params.extend([start_datetime, end_datetime])

    # Priorizar user_ids sobre user_id
    if user_ids and len(user_ids) > 0:
        placeholders = ','.join(['%s'] * len(user_ids))
        query_base += f" AND user_id IN ({placeholders})"
        params.extend([str(uid) for uid in user_ids])
        user_filter_msg = f"Users: {user_ids}"
    elif user_id:
        query_base += " AND user_id = %s"
        params.append(str(user_id))
        user_filter_msg = f"User: {user_id}"
    else:
        user_filter_msg = "All users"

    query = query_base + " ORDER BY ts_orden LIMIT 50000;"

    cursor.execute(query, tuple(params))
    results = cursor.fetchall()
    conn.close()

    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    time_range = f" [{start_datetime} - {end_datetime}]" if start_datetime and end_datetime else ""
    log.info(f"Consulta por Geocerca ({user_filter_msg}){time_range}: {len(coordenadas)} registros encontrados")
    return coordenadas
    
def get_last_coordinate_by_user(user_id):
    """Obtiene la última coordenada de un usuario específico."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT lat, lon, timestamp, source
            FROM coordinates 
            WHERE user_id = %s
            ORDER BY TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') DESC 
            LIMIT 1
        """, (str(user_id),))
        
        data = cursor.fetchone()
        conn.close()

        if data:
            return {
                'success': True,
                'lat': float(data[0]),
                'lon': float(data[1]),
                'timestamp': data[2],
                'source': data[3],
                'user_id': user_id
            }
        return {'success': False, 'error': 'No se encontraron coordenadas para este usuario'}
    except Exception as e:
        log.error(f"Error obteniendo coordenada de usuario {user_id}: {e}")
        return {'success': False, 'error': str(e)}

def get_active_devices():
    """Obtiene dispositivos activos (últimos 2 minutos)."""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SET TIME ZONE 'America/Bogota'")
    
    cursor.execute('''
        SELECT DISTINCT user_id
        FROM coordinates 
        WHERE user_id IS NOT NULL 
          AND TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') 
              >= NOW() - INTERVAL '30 seconds'
    ''')
    
    results = cursor.fetchall()
    conn.close()
    
    devices = [{
        'user_id': user_id,
        'name': f'Usuario {user_id}',
        'last_seen': 'Reciente'
    } for user_id, in results]
    
    log.info(f"Dispositivos activos: {len(devices)}")
    return devices