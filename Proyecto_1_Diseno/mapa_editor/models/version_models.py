"""
============================================================================
MODELOS PARA VERSIONADO DE MAPAS
============================================================================

Este módulo gestiona las versiones de mapas, permitiendo:
- Crear múltiples versiones independientes
- Mantener el mapa original intacto
- Comparar versiones
- Activar/desactivar versiones

Clases principales:
- MapVersion: Gestiona versiones de mapas
- VersionManager: Operaciones de alto nivel con versiones

============================================================================
"""

import sqlite3
import os
from typing import List, Dict, Optional
from datetime import datetime


class MapVersion:
    """Gestiona versiones individuales de mapas"""

    def __init__(self, db):
        """
        Args:
            db: Instancia de MapDatabase
        """
        self.db = db

    def create(
        self,
        name: str,
        description: str = None,
        parent_version_id: int = None,
        is_active: bool = False
    ) -> int:
        """
        Crea una nueva versión de mapa.

        Args:
            name: Nombre de la versión (ej: "Puerto v1")
            description: Descripción de cambios
            parent_version_id: ID de la versión padre (opcional)
            is_active: Si activar esta versión inmediatamente

        Returns:
            ID de la versión creada
        """
        cursor = self.db.get_cursor()
        cursor.execute("""
            INSERT INTO map_versions (name, description, parent_version_id, is_active)
            VALUES (?, ?, ?, ?)
        """, (name, description, parent_version_id, 1 if is_active else 0))

        self.db.commit()
        version_id = cursor.lastrowid

        print(f"✓ Versión creada: {name} (ID: {version_id})")

        return version_id

    def get(self, version_id: int) -> Optional[Dict]:
        """
        Obtiene una versión por ID.

        Args:
            version_id: ID de la versión

        Returns:
            Diccionario con datos de la versión
        """
        cursor = self.db.get_cursor()
        cursor.execute("SELECT * FROM map_versions WHERE id = ?", (version_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

    def get_all(self, include_stats: bool = True) -> List[Dict]:
        """
        Obtiene todas las versiones.

        Args:
            include_stats: Si incluir estadísticas de cada versión

        Returns:
            Lista de versiones
        """
        cursor = self.db.get_cursor()

        if include_stats:
            cursor.execute("""
                SELECT * FROM version_stats
                ORDER BY created_at DESC
            """)
        else:
            cursor.execute("""
                SELECT * FROM map_versions
                ORDER BY created_at DESC
            """)

        return [dict(row) for row in cursor.fetchall()]

    def get_active(self) -> Optional[Dict]:
        """
        Obtiene la versión actualmente activa.

        Returns:
            Versión activa o None
        """
        cursor = self.db.get_cursor()
        cursor.execute("""
            SELECT * FROM map_versions
            WHERE is_active = 1
            LIMIT 1
        """)
        row = cursor.fetchone()
        return dict(row) if row else None

    def activate(self, version_id: int) -> bool:
        """
        Activa una versión (desactiva todas las demás).

        Args:
            version_id: ID de la versión a activar

        Returns:
            True si se activó correctamente
        """
        cursor = self.db.get_cursor()

        # Desactivar todas
        cursor.execute("UPDATE map_versions SET is_active = 0")

        # Activar la seleccionada
        cursor.execute("""
            UPDATE map_versions SET is_active = 1
            WHERE id = ?
        """, (version_id,))

        self.db.commit()

        return cursor.rowcount > 0

    def update(
        self,
        version_id: int,
        name: str = None,
        description: str = None,
        osm_file_path: str = None,
        osrm_data_path: str = None
    ) -> bool:
        """
        Actualiza metadatos de una versión.

        Args:
            version_id: ID de la versión
            name: Nuevo nombre (opcional)
            description: Nueva descripción (opcional)
            osm_file_path: Ruta del archivo OSM (opcional)
            osrm_data_path: Ruta de datos OSRM (opcional)

        Returns:
            True si se actualizó
        """
        updates = []
        params = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if osm_file_path is not None:
            updates.append("osm_file_path = ?")
            params.append(osm_file_path)
        if osrm_data_path is not None:
            updates.append("osrm_data_path = ?")
            params.append(osrm_data_path)

        if not updates:
            return False

        params.append(version_id)
        cursor = self.db.get_cursor()
        cursor.execute(
            f"UPDATE map_versions SET {', '.join(updates)} WHERE id = ?",
            params
        )
        self.db.commit()

        return cursor.rowcount > 0

    def delete(self, version_id: int, cascade: bool = False) -> bool:
        """
        Elimina una versión.

        Args:
            version_id: ID de la versión
            cascade: Si eliminar también nodos/ways asociados

        Returns:
            True si se eliminó
        """
        cursor = self.db.get_cursor()

        # No permitir eliminar la versión activa
        version = self.get(version_id)
        if version and version['is_active']:
            print("⚠️ No se puede eliminar la versión activa")
            return False

        if cascade:
            # Eliminar ways asociados
            cursor.execute("DELETE FROM ways WHERE version_id = ?", (version_id,))
            # Eliminar nodes asociados
            cursor.execute("DELETE FROM nodes WHERE version_id = ?", (version_id,))

        # Eliminar versión
        cursor.execute("DELETE FROM map_versions WHERE id = ?", (version_id,))

        self.db.commit()

        return cursor.rowcount > 0

    def clone(self, source_version_id: int, new_name: str, new_description: str = None) -> int:
        """
        Clona una versión existente (copia todos sus nodos/ways).

        Args:
            source_version_id: ID de la versión a clonar
            new_name: Nombre de la nueva versión
            new_description: Descripción (opcional)

        Returns:
            ID de la nueva versión
        """
        # Crear nueva versión
        new_version_id = self.create(
            name=new_name,
            description=new_description or f"Clon de versión {source_version_id}",
            parent_version_id=source_version_id
        )

        cursor = self.db.get_cursor()

        # Clonar nodes
        cursor.execute("""
            INSERT INTO nodes (osm_id, lat, lon, version_id, visible, deleted, source)
            SELECT osm_id, lat, lon, ?, visible, deleted, source
            FROM nodes
            WHERE version_id = ? AND visible = 1 AND deleted = 0
        """, (new_version_id, source_version_id))

        # Mapeo de IDs antiguos a nuevos
        cursor.execute("""
            SELECT old.id as old_id, new.id as new_id
            FROM nodes old
            JOIN nodes new ON new.lat = old.lat AND new.lon = old.lon
            WHERE old.version_id = ? AND new.version_id = ?
        """, (source_version_id, new_version_id))

        node_mapping = {row['old_id']: row['new_id'] for row in cursor.fetchall()}

        # Clonar ways
        cursor.execute("""
            SELECT * FROM ways
            WHERE version_id = ? AND visible = 1 AND deleted = 0
        """, (source_version_id,))

        for way_row in cursor.fetchall():
            way = dict(way_row)

            # Crear nuevo way
            cursor.execute("""
                INSERT INTO ways (osm_id, name, highway_type, oneway, maxspeed, version_id, visible, deleted, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                way['osm_id'], way['name'], way['highway_type'],
                way['oneway'], way['maxspeed'], new_version_id,
                way['visible'], way['deleted'], way['source']
            ))

            new_way_id = cursor.lastrowid

            # Copiar way_nodes con IDs mapeados
            cursor.execute("""
                SELECT node_id, sequence
                FROM way_nodes
                WHERE way_id = ?
                ORDER BY sequence
            """, (way['id'],))

            for wn_row in cursor.fetchall():
                old_node_id = wn_row['node_id']
                new_node_id = node_mapping.get(old_node_id)

                if new_node_id:
                    cursor.execute("""
                        INSERT INTO way_nodes (way_id, node_id, sequence)
                        VALUES (?, ?, ?)
                    """, (new_way_id, new_node_id, wn_row['sequence']))

        self.db.commit()

        print(f"✓ Versión clonada: {new_name} (ID: {new_version_id})")

        return new_version_id


class VersionManager:
    """Gestión de alto nivel de versiones"""

    def __init__(self, db):
        self.db = db
        self.version_model = MapVersion(db)

    def initialize_schema(self):
        """
        Inicializa el schema de versiones si no existe.
        """
        schema_path = os.path.join(
            os.path.dirname(self.db.db_path),
            'schema_versions.sql'
        )

        if os.path.exists(schema_path):
            with open(schema_path, 'r', encoding='utf-8') as f:
                schema_sql = f.read()
                try:
                    self.db.conn.executescript(schema_sql)
                    self.db.commit()
                    print(f"✓ Schema de versiones inicializado")
                except sqlite3.OperationalError as e:
                    # Puede fallar si las columnas ya existen, lo cual está bien
                    print(f"ℹ️ Schema de versiones ya existente o parcialmente inicializado")
        else:
            print(f"⚠ Advertencia: No se encontró schema_versions.sql")

    def create_version_from_current(self, name: str, description: str = None) -> int:
        """
        Crea una nueva versión basada en la versión activa actual.

        Args:
            name: Nombre de la nueva versión
            description: Descripción

        Returns:
            ID de la nueva versión
        """
        active_version = self.version_model.get_active()

        if not active_version:
            # Si no hay versión activa, usar la base
            active_version = {'id': 1}

        return self.version_model.clone(
            source_version_id=active_version['id'],
            new_name=name,
            new_description=description
        )

    def compare_versions(self, version_id_1: int, version_id_2: int) -> Dict:
        """
        Compara dos versiones y retorna las diferencias.

        Args:
            version_id_1: ID de la primera versión
            version_id_2: ID de la segunda versión

        Returns:
            Diccionario con diferencias
        """
        cursor = self.db.get_cursor()

        # Ways en v1 pero no en v2
        cursor.execute("""
            SELECT w1.*
            FROM ways w1
            WHERE w1.version_id = ? AND w1.visible = 1 AND w1.deleted = 0
            AND NOT EXISTS (
                SELECT 1 FROM ways w2
                WHERE w2.version_id = ? AND w2.visible = 1 AND w2.deleted = 0
                AND w2.name = w1.name
                AND ABS(w2.lat - w1.lat) < 0.00001
            )
        """, (version_id_1, version_id_2))

        only_in_v1 = [dict(row) for row in cursor.fetchall()]

        # Ways en v2 pero no en v1
        cursor.execute("""
            SELECT w2.*
            FROM ways w2
            WHERE w2.version_id = ? AND w2.visible = 1 AND w2.deleted = 0
            AND NOT EXISTS (
                SELECT 1 FROM ways w1
                WHERE w1.version_id = ? AND w1.visible = 1 AND w1.deleted = 0
                AND w1.name = w2.name
            )
        """, (version_id_2, version_id_1))

        only_in_v2 = [dict(row) for row in cursor.fetchall()]

        return {
            'only_in_version_1': only_in_v1,
            'only_in_version_2': only_in_v2,
            'added_count': len(only_in_v2),
            'removed_count': len(only_in_v1)
        }

    def get_summary(self) -> Dict:
        """
        Obtiene un resumen de todas las versiones.

        Returns:
            Resumen con estadísticas
        """
        versions = self.version_model.get_all(include_stats=True)
        active = self.version_model.get_active()

        return {
            'total_versions': len(versions),
            'active_version': active,
            'versions': versions
        }
