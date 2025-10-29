# app/database.py
import psycopg2
from app.config import DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
from datetime import datetime

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
    """Crea la tabla 'coordinates' si no existe."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS coordinates (
            id serial PRIMARY KEY,
            lat REAL NOT NULL,
            lon REAL NOT NULL,
            timestamp TEXT NOT NULL,
            source TEXT NOT NULL
        )
    ''')
    conn.commit()
    conn.close()

def create_users_table():
    """Crea la tabla 'users' si no existe."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id serial PRIMARY KEY,
            firebase_uid TEXT NOT NULL UNIQUE,
            nombre_completo TEXT NOT NULL,
            cedula TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            telefono TEXT,
            empresa TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    ''')
    conn.commit()
    conn.close()

def create_user(firebase_uid, nombre, cedula, email, telefono, empresa):
    """Inserta un nuevo usuario."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO users (firebase_uid, nombre_completo, cedula, email, telefono, empresa) 
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (firebase_uid, nombre, cedula, email, telefono, empresa)
        )
        user_id = cursor.fetchone()[0]
        conn.commit()
        conn.close()
        print(f"✓ Usuario creado en BD: {email} (ID: {user_id})")
        return user_id
    except Exception as e:
        print(f"Error al crear usuario en BD: {e}")
        conn.close()
        return None

def get_user_by_firebase_uid(uid):
    """Busca un usuario por su Firebase UID."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE firebase_uid = %s", (uid,))
    data = cursor.fetchone()
    conn.close()
    if data:
        column_names = ['id', 'firebase_uid', 'nombre_completo', 'cedula', 'email', 'telefono', 'empresa', 'created_at']
        return dict(zip(column_names, data))
    return None

def insert_coordinate(lat, lon, timestamp, source):
    """Inserta una nueva coordenada en la base de datos."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO coordinates (lat, lon, timestamp, source) VALUES (%s, %s, %s, %s)",
            (lat, lon, timestamp, source)
        )
        conn.commit()
        conn.close()
        print(f"✓ Guardado en BD: {lat:.6f}, {lon:.6f} (Fuente: {source})")
    except Exception as e:
        print(f"Error al insertar en BD: {e}")

def get_last_coordinate():
    """Obtiene la última coordenada registrada."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT 1")
    data = cursor.fetchone()
    conn.close()

    if data:
        column_names = ['id', 'lat', 'lon', 'timestamp', 'source']
        return dict(zip(column_names, data))
    return {}

def get_latest_db_records(limit=20):
    """Obtiene los últimos N registros para la vista de base de datos."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT %s", (limit,))
    data = cursor.fetchall()
    # Convertir a lista de dicts para que sea más fácil de usar en la plantilla
    column_names = ['id', 'lat', 'lon', 'timestamp', 'source']
    results = [dict(zip(column_names, row)) for row in data]
    conn.close()
    return results

def get_historical_by_date(fecha_formateada):
    """Obtiene datos históricos por fecha (formato DD/MM/YYYY)."""
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT lat, lon, timestamp FROM coordinates WHERE timestamp LIKE %s ORDER BY timestamp"
    cursor.execute(query, (f"{fecha_formateada}%",))
    results = cursor.fetchall()
    conn.close()
    
    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    print(f"Consulta histórica: {fecha_formateada} - {len(coordenadas)} registros encontrados")
    return coordenadas

def get_historical_by_range(start_datetime, end_datetime):
    """Obtiene datos históricos por rango de datetime (optimizado)."""
    conn = get_db()
    cursor = conn.cursor()
    query = """
        SELECT DISTINCT 
            lat, 
            lon, 
            timestamp, 
            TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') AS ts_orden
        FROM coordinates
        WHERE TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS')
              BETWEEN %s AND %s
        ORDER BY ts_orden
        LIMIT 50000;
    """
    cursor.execute(query, (start_datetime, end_datetime))
    results = cursor.fetchall()
    conn.close()
    
    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    print(f"Consulta optimizada: {start_datetime} a {end_datetime} - {len(coordenadas)} registros encontrados")
    return coordenadas

def get_historical_by_geofence(min_lat, max_lat, min_lon, max_lon):
    """Obtiene datos históricos por geocerca (bounds)."""
    conn = get_db()
    cursor = conn.cursor()
    query = """
        SELECT DISTINCT 
            lat, 
            lon, 
            timestamp,
            TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') AS ts_orden
        FROM coordinates
        WHERE (lat BETWEEN %s AND %s)
          AND (lon BETWEEN %s AND %s)
        ORDER BY ts_orden
        LIMIT 50000;
    """
    cursor.execute(query, (min_lat, max_lat, min_lon, max_lon))
    results = cursor.fetchall()
    conn.close()
    
    coordenadas = [{'lat': float(r[0]), 'lon': float(r[1]), 'timestamp': r[2]} for r in results]
    print(f"Consulta por Geocerca: {len(coordenadas)} registros encontrados")
    return coordenadas