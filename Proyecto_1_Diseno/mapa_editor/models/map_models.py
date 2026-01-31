"""
============================================================================
MODELOS DE DATOS PARA EDITOR DE MAPAS OSRM
============================================================================

Este módulo contiene las clases para interactuar con la base de datos
del editor de mapas. Maneja nodos, calles (ways), y sus relaciones.

Clases principales:
- MapDatabase: Gestiona la conexión y operaciones de la BD
- Node: Representa un punto en el mapa (lat/lon)
- Way: Representa una calle (colección de nodos)
- Tag: Metadatos adicionales para nodos/calles

============================================================================
"""

import sqlite3
import os
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import json


class MapDatabase:
    """Gestiona la conexión a la base de datos del editor de mapas"""

    def __init__(self, db_path: str = None):
        """
        Inicializa la conexión a la base de datos.

        Args:
            db_path: Ruta a la base de datos SQLite. Si es None, usa la ruta por defecto.
        """
        if db_path is None:
            current_dir = os.path.dirname(os.path.abspath(__file__))
            db_path = os.path.join(current_dir, '..', 'database', 'mapa_editor.db')

        self.db_path = db_path
        self.conn = None
        self._initialize_database()

    def _initialize_database(self):
        """Crea la base de datos y las tablas si no existen"""
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row  # Para acceder a columnas por nombre

        # Leer y ejecutar el schema principal
        schema_path = os.path.join(os.path.dirname(self.db_path), 'schema.sql')
        if os.path.exists(schema_path):
            with open(schema_path, 'r', encoding='utf-8') as f:
                schema_sql = f.read()
                self.conn.executescript(schema_sql)
                self.conn.commit()
                print(f"✓ Base de datos inicializada: {self.db_path}")
        else:
            print(f"⚠ Advertencia: No se encontró schema.sql en {schema_path}")

        # Leer y ejecutar el schema de versiones
        schema_versions_path = os.path.join(os.path.dirname(self.db_path), 'schema_versions.sql')
        if os.path.exists(schema_versions_path):
            with open(schema_versions_path, 'r', encoding='utf-8') as f:
                schema_versions_sql = f.read()
                try:
                    self.conn.executescript(schema_versions_sql)
                    self.conn.commit()
                    print(f"✓ Schema de versiones inicializado")
                except sqlite3.OperationalError as e:
                    # Puede fallar si las columnas ya existen
                    print(f"ℹ️ Schema de versiones ya existe")

    def get_cursor(self):
        """Retorna un cursor para ejecutar queries"""
        return self.conn.cursor()

    def commit(self):
        """Guarda los cambios en la base de datos"""
        self.conn.commit()

    def close(self):
        """Cierra la conexión a la base de datos"""
        if self.conn:
            self.conn.close()

    def get_stats(self) -> Dict:
        """Retorna estadísticas generales de la base de datos"""
        cursor = self.get_cursor()
        cursor.execute("SELECT * FROM map_stats")
        row = cursor.fetchone()
        return dict(row) if row else {}


class Node:
    """Representa un nodo (punto) en el mapa"""

    def __init__(self, db: MapDatabase):
        self.db = db

    def create(self, lat: float, lon: float, osm_id: int = None) -> int:
        """
        Crea un nuevo nodo en la base de datos.

        Args:
            lat: Latitud (-90 a 90)
            lon: Longitud (-180 a 180)
            osm_id: ID compatible con OSM (opcional)

        Returns:
            ID del nodo creado
        """
        cursor = self.db.get_cursor()
        cursor.execute(
            "INSERT INTO nodes (osm_id, lat, lon) VALUES (?, ?, ?)",
            (osm_id, lat, lon)
        )
        self.db.commit()
        return cursor.lastrowid

    def get(self, node_id: int) -> Optional[Dict]:
        """
        Obtiene un nodo por su ID.

        Args:
            node_id: ID del nodo

        Returns:
            Diccionario con datos del nodo o None si no existe
        """
        cursor = self.db.get_cursor()
        cursor.execute("SELECT * FROM nodes WHERE id = ?", (node_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_all(self, limit: int = 1000) -> List[Dict]:
        """
        Obtiene todos los nodos.

        Args:
            limit: Límite de resultados

        Returns:
            Lista de diccionarios con datos de nodos
        """
        cursor = self.db.get_cursor()
        cursor.execute("SELECT * FROM nodes LIMIT ?", (limit,))
        return [dict(row) for row in cursor.fetchall()]

    def update(self, node_id: int, lat: float = None, lon: float = None) -> bool:
        """
        Actualiza un nodo existente.

        Args:
            node_id: ID del nodo
            lat: Nueva latitud (opcional)
            lon: Nueva longitud (opcional)

        Returns:
            True si se actualizó correctamente
        """
        updates = []
        params = []

        if lat is not None:
            updates.append("lat = ?")
            params.append(lat)
        if lon is not None:
            updates.append("lon = ?")
            params.append(lon)

        if not updates:
            return False

        params.append(node_id)
        cursor = self.db.get_cursor()
        cursor.execute(
            f"UPDATE nodes SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.db.commit()
        return cursor.rowcount > 0

    def delete(self, node_id: int) -> bool:
        """
        Elimina un nodo.

        Args:
            node_id: ID del nodo

        Returns:
            True si se eliminó correctamente
        """
        cursor = self.db.get_cursor()
        cursor.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
        self.db.commit()
        return cursor.rowcount > 0

    def find_nearby(self, lat: float, lon: float, radius: float = 0.001) -> List[Dict]:
        """
        Encuentra nodos cercanos a una coordenada.

        Args:
            lat: Latitud de referencia
            lon: Longitud de referencia
            radius: Radio de búsqueda (grados, aprox. 0.001 = ~110m)

        Returns:
            Lista de nodos cercanos
        """
        cursor = self.db.get_cursor()
        cursor.execute("""
            SELECT * FROM nodes
            WHERE lat BETWEEN ? AND ?
            AND lon BETWEEN ? AND ?
            ORDER BY
                ((lat - ?) * (lat - ?) + (lon - ?) * (lon - ?)) ASC
            LIMIT 50
        """, (
            lat - radius, lat + radius,
            lon - radius, lon + radius,
            lat, lat, lon, lon
        ))
        return [dict(row) for row in cursor.fetchall()]


class Way:
    """Representa una calle (way) en el mapa"""

    def __init__(self, db: MapDatabase):
        self.db = db

    def create(
        self,
        node_ids: List[int],
        name: str = None,
        highway_type: str = 'road',
        oneway: bool = False,
        maxspeed: int = None,
        osm_id: int = None
    ) -> int:
        """
        Crea una nueva calle.

        Args:
            node_ids: Lista de IDs de nodos que forman la calle (en orden)
            name: Nombre de la calle
            highway_type: Tipo de vía (road, residential, primary, etc.)
            oneway: True si es de un solo sentido
            maxspeed: Velocidad máxima en km/h
            osm_id: ID compatible con OSM (opcional)

        Returns:
            ID de la calle creada
        """
        if len(node_ids) < 2:
            raise ValueError("Una calle debe tener al menos 2 nodos")

        cursor = self.db.get_cursor()

        # Crear el way
        cursor.execute("""
            INSERT INTO ways (osm_id, name, highway_type, oneway, maxspeed)
            VALUES (?, ?, ?, ?, ?)
        """, (osm_id, name, highway_type, 1 if oneway else 0, maxspeed))

        way_id = cursor.lastrowid

        # Asociar nodos a la calle (con orden)
        for sequence, node_id in enumerate(node_ids, start=1):
            cursor.execute("""
                INSERT INTO way_nodes (way_id, node_id, sequence)
                VALUES (?, ?, ?)
            """, (way_id, node_id, sequence))

        self.db.commit()
        return way_id

    def get(self, way_id: int) -> Optional[Dict]:
        """
        Obtiene una calle por su ID, incluyendo sus nodos.

        Args:
            way_id: ID de la calle

        Returns:
            Diccionario con datos de la calle y sus nodos
        """
        cursor = self.db.get_cursor()

        # Obtener datos del way
        cursor.execute("SELECT * FROM ways WHERE id = ?", (way_id,))
        way_row = cursor.fetchone()

        if not way_row:
            return None

        way_data = dict(way_row)

        # Obtener nodos asociados (ordenados)
        cursor.execute("""
            SELECT n.*, wn.sequence
            FROM nodes n
            JOIN way_nodes wn ON n.id = wn.node_id
            WHERE wn.way_id = ?
            ORDER BY wn.sequence
        """, (way_id,))

        way_data['nodes'] = [dict(row) for row in cursor.fetchall()]

        return way_data

    def get_all(self, limit: int = 1000) -> List[Dict]:
        """
        Obtiene todas las calles con sus nodos.

        Args:
            limit: Límite de resultados

        Returns:
            Lista de calles con sus nodos
        """
        cursor = self.db.get_cursor()
        cursor.execute("SELECT * FROM ways LIMIT ?", (limit,))
        ways = []

        for way_row in cursor.fetchall():
            way_data = dict(way_row)
            way_id = way_data['id']

            # Obtener nodos de esta calle
            cursor.execute("""
                SELECT n.*, wn.sequence
                FROM nodes n
                JOIN way_nodes wn ON n.id = wn.node_id
                WHERE wn.way_id = ?
                ORDER BY wn.sequence
            """, (way_id,))

            way_data['nodes'] = [dict(row) for row in cursor.fetchall()]
            ways.append(way_data)

        return ways

    def update(
        self,
        way_id: int,
        name: str = None,
        highway_type: str = None,
        oneway: bool = None,
        maxspeed: int = None
    ) -> bool:
        """
        Actualiza una calle existente.

        Args:
            way_id: ID de la calle
            name: Nuevo nombre (opcional)
            highway_type: Nuevo tipo (opcional)
            oneway: Nuevo estado de un solo sentido (opcional)
            maxspeed: Nueva velocidad máxima (opcional)

        Returns:
            True si se actualizó correctamente
        """
        updates = []
        params = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if highway_type is not None:
            updates.append("highway_type = ?")
            params.append(highway_type)
        if oneway is not None:
            updates.append("oneway = ?")
            params.append(1 if oneway else 0)
        if maxspeed is not None:
            updates.append("maxspeed = ?")
            params.append(maxspeed)

        if not updates:
            return False

        params.append(way_id)
        cursor = self.db.get_cursor()
        cursor.execute(
            f"UPDATE ways SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.db.commit()
        return cursor.rowcount > 0

    def update_nodes(self, way_id: int, node_ids: List[int]) -> bool:
        """
        Actualiza los nodos de una calle (reemplaza completamente).

        Args:
            way_id: ID de la calle
            node_ids: Nueva lista de IDs de nodos (en orden)

        Returns:
            True si se actualizó correctamente
        """
        if len(node_ids) < 2:
            raise ValueError("Una calle debe tener al menos 2 nodos")

        cursor = self.db.get_cursor()

        # Eliminar nodos anteriores
        cursor.execute("DELETE FROM way_nodes WHERE way_id = ?", (way_id,))

        # Insertar nuevos nodos
        for sequence, node_id in enumerate(node_ids, start=1):
            cursor.execute("""
                INSERT INTO way_nodes (way_id, node_id, sequence)
                VALUES (?, ?, ?)
            """, (way_id, node_id, sequence))

        self.db.commit()
        return True

    def delete(self, way_id: int) -> bool:
        """
        Elimina una calle (y sus relaciones con nodos).

        Args:
            way_id: ID de la calle

        Returns:
            True si se eliminó correctamente
        """
        cursor = self.db.get_cursor()
        cursor.execute("DELETE FROM ways WHERE id = ?", (way_id,))
        self.db.commit()
        return cursor.rowcount > 0


class Tag:
    """Representa metadatos adicionales para nodos/calles"""

    def __init__(self, db: MapDatabase):
        self.db = db

    def set(self, entity_type: str, entity_id: int, key: str, value: str) -> int:
        """
        Establece un tag (crea o actualiza).

        Args:
            entity_type: 'node' o 'way'
            entity_id: ID del nodo o calle
            key: Clave del tag (ej: 'lanes', 'bridge')
            value: Valor del tag (ej: '2', 'yes')

        Returns:
            ID del tag
        """
        cursor = self.db.get_cursor()
        cursor.execute("""
            INSERT INTO tags (entity_type, entity_id, key, value)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(entity_type, entity_id, key)
            DO UPDATE SET value = excluded.value
        """, (entity_type, entity_id, key, value))
        self.db.commit()
        return cursor.lastrowid

    def get(self, entity_type: str, entity_id: int) -> Dict[str, str]:
        """
        Obtiene todos los tags de una entidad.

        Args:
            entity_type: 'node' o 'way'
            entity_id: ID del nodo o calle

        Returns:
            Diccionario con todos los tags (key: value)
        """
        cursor = self.db.get_cursor()
        cursor.execute("""
            SELECT key, value FROM tags
            WHERE entity_type = ? AND entity_id = ?
        """, (entity_type, entity_id))

        return {row['key']: row['value'] for row in cursor.fetchall()}

    def delete(self, entity_type: str, entity_id: int, key: str = None) -> bool:
        """
        Elimina tags de una entidad.

        Args:
            entity_type: 'node' o 'way'
            entity_id: ID del nodo o calle
            key: Clave específica a eliminar (opcional, si es None elimina todos)

        Returns:
            True si se eliminó correctamente
        """
        cursor = self.db.get_cursor()

        if key:
            cursor.execute("""
                DELETE FROM tags
                WHERE entity_type = ? AND entity_id = ? AND key = ?
            """, (entity_type, entity_id, key))
        else:
            cursor.execute("""
                DELETE FROM tags
                WHERE entity_type = ? AND entity_id = ?
            """, (entity_type, entity_id))

        self.db.commit()
        return cursor.rowcount > 0


# ============================================================================
# FUNCIONES DE UTILIDAD
# ============================================================================

def get_map_database() -> MapDatabase:
    """
    Función helper para obtener una instancia de MapDatabase.
    Útil para importar en otros módulos.
    """
    return MapDatabase()


def export_to_geojson(db: MapDatabase) -> Dict:
    """
    Exporta todas las calles a formato GeoJSON para visualización.

    Args:
        db: Instancia de MapDatabase

    Returns:
        Diccionario en formato GeoJSON
    """
    way_model = Way(db)
    ways = way_model.get_all()

    features = []

    for way in ways:
        # Convertir nodos a coordenadas [lon, lat] (GeoJSON usa lon, lat)
        coordinates = [[node['lon'], node['lat']] for node in way['nodes']]

        feature = {
            'type': 'Feature',
            'geometry': {
                'type': 'LineString',
                'coordinates': coordinates
            },
            'properties': {
                'id': way['id'],
                'name': way['name'] or 'Sin nombre',
                'highway_type': way['highway_type'],
                'oneway': bool(way['oneway']),
                'maxspeed': way['maxspeed']
            }
        }
        features.append(feature)

    return {
        'type': 'FeatureCollection',
        'features': features
    }
