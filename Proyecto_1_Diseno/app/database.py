# app/database.py
import psycopg2
from app.config import DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

def create_segments_cache_table():
    """
    Crea una tabla para cachear información de segmentos de red.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS segments_cache (
            segment_id TEXT PRIMARY KEY,
            street_name TEXT NOT NULL,
            segment_length REAL DEFAULT 0,
            bearing INTEGER DEFAULT 0,
            start_lat REAL NOT NULL,
            start_lon REAL NOT NULL,
            end_lat REAL NOT NULL,
            end_lon REAL NOT NULL,
            geometry JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_segments_cache_street_name
        ON segments_cache(street_name);
    ''')
    
    conn.commit()
    conn.close()
    log.info("✓ Tabla 'segments_cache' verificada/creada")


def cache_segment(segment_id, street_name, segment_length, bearing, 
                  start_lat, start_lon, end_lat, end_lon, geometry=None):
    """
    Cachea información de un segmento para uso futuro.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            INSERT INTO segments_cache 
            (segment_id, street_name, segment_length, bearing, 
             start_lat, start_lon, end_lat, end_lon, geometry)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (segment_id) DO UPDATE SET
                street_name = EXCLUDED.street_name,
                segment_length = EXCLUDED.segment_length,
                bearing = EXCLUDED.bearing,
                start_lat = EXCLUDED.start_lat,
                start_lon = EXCLUDED.start_lon,
                end_lat = EXCLUDED.end_lat,
                end_lon = EXCLUDED.end_lon,
                geometry = EXCLUDED.geometry,
                updated_at = CURRENT_TIMESTAMP
        """, (segment_id, street_name, segment_length, bearing,
              start_lat, start_lon, end_lat, end_lon, 
              json.dumps(geometry) if geometry else None))
        
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        log.error(f"Error cacheando segmento {segment_id}: {e}")
        return False


def get_cached_segment(segment_id):
    """
    Obtiene un segmento desde la caché.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        cursor.execute("""
            SELECT segment_id, street_name, segment_length, bearing,
                   start_lat, start_lon, end_lat, end_lon, geometry
            FROM segments_cache
            WHERE segment_id = %s
        """, (segment_id,))
        
        result = cursor.fetchone()
        conn.close()
        
        if result:
            return {
                'segment_id': result[0],
                'street_name': result[1],
                'segment_length': float(result[2]),
                'bearing': int(result[3]),
                'nodes': [
                    {'lat': float(result[4]), 'lon': float(result[5])},
                    {'lat': float(result[6]), 'lon': float(result[7])}
                ],
                'geometry': json.loads(result[8]) if result[8] else None
            }
        return None
    except Exception as e:
        log.error(f"Error obteniendo segmento cacheado {segment_id}: {e}")
        return None
        
def get_db():
    """Establece una nueva conexión a la base de datos."""
    conn = psycopg2.connect(
        host=DB_HOST,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD
    )
    return conn

def migrate_table():
    """
    Migra la tabla coordinates eliminando columnas obsoletas.
    Ejecutar esta función UNA SOLA VEZ para migrar de la estructura antigua a la nueva.
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        log.info("Iniciando migración de tabla coordinates...")
        
        # Eliminar columnas device_name y device_id si existen
        cursor.execute('''
            ALTER TABLE coordinates 
            DROP COLUMN IF EXISTS device_name;
        ''')
        log.info("✓ Columna device_name eliminada")
        
        cursor.execute('''
            ALTER TABLE coordinates 
            DROP COLUMN IF EXISTS device_id;
        ''')
        log.info("✓ Columna device_id eliminada")
        
        # Asegurar que los tipos de datos sean correctos
        cursor.execute('''
            ALTER TABLE coordinates 
            ALTER COLUMN lat TYPE REAL;
        ''')
        
        cursor.execute('''
            ALTER TABLE coordinates 
            ALTER COLUMN lon TYPE REAL;
        ''')
        
        cursor.execute('''
            ALTER TABLE coordinates 
            ALTER COLUMN timestamp TYPE TEXT;
        ''')
        
        cursor.execute('''
            ALTER TABLE coordinates 
            ALTER COLUMN source TYPE TEXT;
        ''')
        
        cursor.execute('''
            ALTER TABLE coordinates 
            ALTER COLUMN user_id TYPE TEXT;
        ''')
        
        cursor.execute('''
            ALTER TABLE coordinates 
            ALTER COLUMN user_id DROP NOT NULL;
        ''')
        
        log.info("✓ Tipos de datos verificados/ajustados")
        
        conn.commit()
        conn.close()
        log.info("✓ Migración completada exitosamente")
        return True
        
    except Exception as e:
        log.error(f"Error durante la migración: {e}")
        if conn:
            conn.rollback()
            conn.close()
        return False

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

def create_usuarios_web_table():  # ← Era create_usuarios_table()
    """
    Crea la tabla 'usuarios_web' si no existe.
    user_id es la llave primaria (misma que se usa en coordinates).
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS usuarios_web (
            user_id TEXT PRIMARY KEY,
            cedula TEXT NOT NULL,
            nombre_completo TEXT NOT NULL,
            email TEXT NOT NULL,
            telefono TEXT,
            empresa TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_usuarios_web_cedula
        ON usuarios_web(cedula);
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_usuarios_web_empresa
        ON usuarios_web(empresa);
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_usuarios_web_email
        ON usuarios_web(email);
    ''')

    conn.commit()
    conn.close()
    log.info("✓ Tabla 'usuarios_web' verificada/creada")


def create_rutas_table():
    """
    Crea la tabla 'rutas' para almacenar rutas preestablecidas por empresa.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS rutas (
            id SERIAL PRIMARY KEY,
            nombre_ruta TEXT NOT NULL,
            empresa TEXT NOT NULL,
            segment_ids TEXT NOT NULL,
            descripcion TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            activa BOOLEAN DEFAULT TRUE
        )
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_rutas_empresa
        ON rutas(empresa);
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_rutas_activa
        ON rutas(activa);
    ''')
    
    cursor.execute('''
        CREATE INDEX IF NOT EXISTS idx_rutas_nombre
        ON rutas(nombre_ruta);
    ''')

    conn.commit()
    conn.close()
    log.info("✓ Tabla 'rutas' verificada/creada")

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

def migrate_add_completed_at():
    """Migración para agregar completed_at a destinations."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Verificar si la columna ya existe
        cursor.execute("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name='destinations' AND column_name='completed_at'
        """)
        
        if cursor.fetchone() is None:
            log.info("🔄 Agregando columna completed_at a destinations...")
            
            cursor.execute("ALTER TABLE destinations ADD COLUMN completed_at TIMESTAMP NULL")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_destinations_status ON destinations(status)")
            
            conn.commit()
            log.info("✅ Migración completed_at completada")
        else:
            log.info("✓ Columna completed_at ya existe")
        
        conn.close()
    except Exception as e:
        log.error(f"❌ Error en migración completed_at: {e}")
        raise
    
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

def insert_user_registration(user_id, cedula, nombre_completo, email, telefono, empresa):
    """
    Inserta o actualiza un usuario en la base de datos.
    user_id es la llave primaria (mismo que se usa en coordinates).
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO usuarios_web 
            (user_id, cedula, nombre_completo, email, telefono, empresa)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id) DO UPDATE SET
                cedula = EXCLUDED.cedula,
                nombre_completo = EXCLUDED.nombre_completo,
                email = EXCLUDED.email,
                telefono = EXCLUDED.telefono,
                empresa = EXCLUDED.empresa,
                updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, cedula, nombre_completo, email, telefono, empresa)
        )
        conn.commit()
        conn.close()
        
        log.info(f"✓ Usuario guardado en BD: {user_id} | Cédula: {cedula} | Empresa: {empresa}")
    except Exception as e:
        log.error(f"❌ Error al insertar usuario en BD: {e}")
        raise


def insert_ruta(nombre_ruta, empresa, segment_ids, descripcion=None):
    """
    Inserta una nueva ruta preestablecida.
    segment_ids debe ser una cadena con IDs separados por comas.
    Ejemplo: "seg_123,seg_456,seg_789"
    """
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """INSERT INTO rutas 
            (nombre_ruta, empresa, segment_ids, descripcion)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (nombre_ruta, empresa, segment_ids, descripcion)
        )
        ruta_id = cursor.fetchone()[0]
        conn.commit()
        conn.close()
        
        log.info(f"✓ Ruta guardada: {nombre_ruta} | Empresa: {empresa} | ID: {ruta_id}")
        return ruta_id
    except Exception as e:
        log.error(f"❌ Error al insertar ruta: {e}")
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
            user_id,
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

    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2], 'user_id': r[3]} for r in results]
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
            user_id,
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

    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2], 'user_id': r[3]} for r in results]
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


def get_rutas_by_empresa(empresa):
    """Obtiene todas las rutas activas de una empresa."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, nombre_ruta, segment_ids, descripcion, created_at, updated_at
            FROM rutas 
            WHERE empresa = %s AND activa = TRUE
            ORDER BY created_at DESC
            """,
            (empresa,)
        )
        results = cursor.fetchall()
        conn.close()
        
        rutas = []
        for row in results:
            rutas.append({
                'id': row[0],
                'nombre_ruta': row[1],
                'segment_ids': row[2],
                'descripcion': row[3],
                'created_at': row[4].strftime('%d/%m/%Y %H:%M:%S') if row[4] else None,
                'updated_at': row[5].strftime('%d/%m/%Y %H:%M:%S') if row[5] else None
            })
        
        log.info(f"Rutas encontradas para {empresa}: {len(rutas)}")
        return rutas
    except Exception as e:
        log.error(f"❌ Error obteniendo rutas: {e}")
        return []

def get_all_rutas():
    """Obtiene todas las rutas activas agrupadas por empresa."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT id, nombre_ruta, empresa, segment_ids, descripcion, created_at
            FROM rutas 
            WHERE activa = TRUE
            ORDER BY empresa, created_at DESC
            """
        )
        results = cursor.fetchall()
        conn.close()
        
        rutas = []
        for row in results:
            rutas.append({
                'id': row[0],
                'nombre_ruta': row[1],
                'empresa': row[2],
                'segment_ids': row[3],
                'descripcion': row[4],
                'created_at': row[5].strftime('%d/%m/%Y %H:%M:%S') if row[5] else None
            })
        
        log.info(f"Total de rutas activas: {len(rutas)}")
        return rutas
    except Exception as e:
        log.error(f"❌ Error obteniendo todas las rutas: {e}")
        return []

def get_empresas_from_usuarios():
    """Obtiene lista de empresas únicas registradas en tabla usuarios_web."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """SELECT DISTINCT empresa 
            FROM usuarios_web 
            WHERE empresa IS NOT NULL AND empresa != ''
            ORDER BY empresa
            """
        )
        results = cursor.fetchall()
        conn.close()
        
        empresas = [row[0] for row in results]
        log.info(f"Empresas encontradas: {len(empresas)}")
        return empresas
    except Exception as e:
        log.error(f"❌ Error obteniendo empresas: {e}")
        return []

def update_ruta(ruta_id, nombre_ruta=None, segment_ids=None, descripcion=None):
    """Actualiza una ruta existente."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        updates = []
        params = []
        
        if nombre_ruta is not None:
            updates.append("nombre_ruta = %s")
            params.append(nombre_ruta)
        if segment_ids is not None:
            updates.append("segment_ids = %s")
            params.append(segment_ids)
        if descripcion is not None:
            updates.append("descripcion = %s")
            params.append(descripcion)
        
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(ruta_id)
        
        query = f"UPDATE rutas SET {', '.join(updates)} WHERE id = %s"
        cursor.execute(query, tuple(params))
        
        conn.commit()
        conn.close()
        
        log.info(f"✓ Ruta {ruta_id} actualizada")
        return True
    except Exception as e:
        log.error(f"❌ Error actualizando ruta: {e}")
        return False

def delete_ruta(ruta_id):
    """Desactiva una ruta (soft delete)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "UPDATE rutas SET activa = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = %s",
            (ruta_id,)
        )
        conn.commit()
        conn.close()
        
        log.info(f"✓ Ruta {ruta_id} desactivada")
        return True
    except Exception as e:
        log.error(f"❌ Error desactivando ruta: {e}")
        return False