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
            source TEXT NOT NULL,
            device_id TEXT,
            device_name TEXT     
        )
    ''')
    conn.commit()
    conn.close()

def execute_migration_sql(sql_command: str, success_message: str):
    """
    Ejecuta un comando SQL de migración y maneja las excepciones comunes.

    Args:
        sql_command: El comando SQL a ejecutar (ej: ALTER TABLE...).
        success_message: Mensaje a mostrar si la ejecución es exitosa.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    print(f"Ejecutando: {sql_command.strip()}")
    
    try:
        cursor.execute(sql_command)
        print(f"✓ {success_message}")
        conn.commit()
    
    # Maneja el error específico de PostgreSQL cuando una columna ya existe
    except psycopg2.errors.DuplicateColumn:
        print("ⓘ Falló: La columna ya existe. Se omite el cambio.")
        
    # Maneja el error específico de PostgreSQL cuando la tabla no existe
    except psycopg2.errors.UndefinedTable:
        print("⚠️ Falló: La tabla no existe. Asegúrate de que 'create_table()' se haya ejecutado.")

    # Maneja otros errores (permisos, sintaxis, etc.)
    except Exception as e:
        print(f"❌ Error en la migración: {e}")
        
    conn.close()


def migrate_device_columns():
    """Ejemplo de uso de la función general para añadir las columnas device_id y device_name."""
    
    # 1. Añadir device_id
    execute_migration_sql(
        "ALTER TABLE coordinates ADD COLUMN device_id TEXT",
        "Columna 'device_id' añadida con éxito."
    )
    
    # 2. Añadir device_name
    execute_migration_sql(
        "ALTER TABLE coordinates ADD COLUMN device_name TEXT",
        "Columna 'device_name' añadida con éxito."
    )
    
def drop_user_id_column():
    """Elimina la columna 'user_id' de la tabla 'coordinates' si existe."""
    conn = get_db()
    cursor = conn.cursor()
    
    print("Verificando existencia de columna 'user_id'...")
    
    try:
        # Verificar si la columna existe
        cursor.execute("""
            SELECT 1 FROM information_schema.columns 
            WHERE table_name='coordinates' AND column_name='user_id'
        """)
        exists = cursor.fetchone()
        
        if exists:
            print("Columna 'user_id' encontrada. Eliminando...")
            cursor.execute("ALTER TABLE coordinates DROP COLUMN user_id CASCADE")
            conn.commit()
            print("✓ Columna 'user_id' eliminada con éxito.")
        else:
            print("ⓘ La columna 'user_id' no existe. No se requiere acción.")
    
    except Exception as e:
        print(f"❌ Error al eliminar columna 'user_id': {e}")
        conn.rollback()
    
    finally:
        conn.close()

def insert_coordinate(lat, lon, timestamp, source, device_id, device_name):
    """Inserta una nueva coordenada en la base de datos."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO coordinates (lat, lon, timestamp, source, device_id, device_name) VALUES (%s, %s, %s, %s, %s, %s)",
            (lat, lon, timestamp, source, device_id, device_name)
        )
        conn.commit()
        conn.close()
        print(f"✓ Guardado en BD para {device_name}: {lat:.6f}, {lon:.6f}")
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
        column_names = ['id', 'lat', 'lon', 'timestamp', 'source', 'device_id', 'device_name']
        return dict(zip(column_names, data))
    return {}

def get_latest_db_records(limit=20):
    """Obtiene los últimos N registros para la vista de base de datos."""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM coordinates ORDER BY id DESC LIMIT %s", (limit,))
    data = cursor.fetchall()
    # Convertir a lista de dicts para que sea más fácil de usar en la plantilla
    column_names = ['id', 'lat', 'lon', 'timestamp', 'source', 'device_id', 'device_name']
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