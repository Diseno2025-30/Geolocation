"""
============================================================================
SERVICIO OSM - EXPORTACIÓN A FORMATO OPENSTREETMAP
============================================================================

Este módulo convierte los datos de la base de datos del editor
al formato OSM XML que OSRM puede procesar.

Funciones principales:
- export_to_osm_xml(): Exporta toda la base de datos a archivo .osm
- generate_osm_xml(): Genera el XML completo
- validate_osm_data(): Valida que los datos sean correctos

Formato OSM XML:
<osm version="0.6">
  <node id="1" lat="11.0" lon="-74.8">
    <tag k="name" v="Punto 1"/>
  </node>
  <way id="1">
    <nd ref="1"/>
    <nd ref="2"/>
    <tag k="highway" v="primary"/>
    <tag k="name" v="Calle Principal"/>
  </way>
</osm>

============================================================================
"""

import os
import xml.etree.ElementTree as ET
from xml.dom import minidom
from datetime import datetime
from typing import Dict, List, Optional
import sys

# Importar modelos
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from models.map_models import MapDatabase, Node, Way, Tag


class OSMExporter:
    """Exporta datos del editor a formato OSM XML"""

    def __init__(self, db: MapDatabase):
        """
        Inicializa el exportador OSM.

        Args:
            db: Instancia de MapDatabase
        """
        self.db = db
        self.node_model = Node(db)
        self.way_model = Way(db)
        self.tag_model = Tag(db)

    def generate_osm_xml(self) -> str:
        """
        Genera el contenido XML en formato OSM.

        Returns:
            String con el XML completo
        """
        # Crear elemento raíz
        osm = ET.Element('osm', version='0.6', generator='MapEditor/1.0')

        # Obtener todos los nodos
        nodes = self.node_model.get_all(limit=100000)
        print(f"Exportando {len(nodes)} nodos...")

        for node_data in nodes:
            node_elem = ET.SubElement(
                osm,
                'node',
                id=str(node_data['id']),
                lat=str(node_data['lat']),
                lon=str(node_data['lon']),
                version='1',
                timestamp=node_data.get('created_at', datetime.now().isoformat())
            )

            # Agregar tags del nodo si existen
            tags = self.tag_model.get('node', node_data['id'])
            for key, value in tags.items():
                ET.SubElement(node_elem, 'tag', k=key, v=value)

        # Obtener todas las calles (ways)
        ways = self.way_model.get_all(limit=100000)
        print(f"Exportando {len(ways)} calles (ways)...")

        for way_data in ways:
            way_elem = ET.SubElement(
                osm,
                'way',
                id=str(way_data['id']),
                version='1',
                timestamp=way_data.get('created_at', datetime.now().isoformat())
            )

            # Agregar referencias a nodos (en orden)
            for node in way_data['nodes']:
                ET.SubElement(way_elem, 'nd', ref=str(node['id']))

            # Agregar tags de la calle
            # Tag principal: highway (OBLIGATORIO para OSRM)
            ET.SubElement(
                way_elem,
                'tag',
                k='highway',
                v=way_data.get('highway_type', 'road')
            )

            # Tag: nombre de la calle
            if way_data.get('name'):
                ET.SubElement(way_elem, 'tag', k='name', v=way_data['name'])

            # Tag: sentido único
            if way_data.get('oneway'):
                ET.SubElement(way_elem, 'tag', k='oneway', v='yes')

            # Tag: velocidad máxima
            if way_data.get('maxspeed'):
                ET.SubElement(
                    way_elem,
                    'tag',
                    k='maxspeed',
                    v=str(way_data['maxspeed'])
                )

            # Agregar tags adicionales del way
            extra_tags = self.tag_model.get('way', way_data['id'])
            for key, value in extra_tags.items():
                # Evitar duplicar tags que ya agregamos
                if key not in ['highway', 'name', 'oneway', 'maxspeed']:
                    ET.SubElement(way_elem, 'tag', k=key, v=value)

        # Convertir a string con formato bonito
        xml_string = ET.tostring(osm, encoding='utf-8')
        dom = minidom.parseString(xml_string)
        pretty_xml = dom.toprettyxml(indent='  ', encoding='utf-8')

        return pretty_xml.decode('utf-8')

    def export_to_osm_file(self, output_path: str = None) -> str:
        """
        Exporta los datos a un archivo .osm

        Args:
            output_path: Ruta del archivo de salida. Si es None, usa ruta por defecto.

        Returns:
            Ruta del archivo generado
        """
        if output_path is None:
            # Usar directorio de exports
            current_dir = os.path.dirname(os.path.abspath(__file__))
            exports_dir = os.path.join(
                current_dir,
                '..',
                'database',
                'exports'
            )
            os.makedirs(exports_dir, exist_ok=True)

            # Nombre con timestamp
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_path = os.path.join(exports_dir, f'mapa_{timestamp}.osm')

        print(f"Generando archivo OSM: {output_path}")

        # Generar XML
        xml_content = self.generate_osm_xml()

        # Guardar archivo
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(xml_content)

        print(f"✓ Archivo OSM generado exitosamente: {output_path}")

        # Registrar en historial de exportaciones
        self._save_export_history(output_path, 'success')

        return output_path

    def _save_export_history(
        self,
        osm_file_path: str,
        status: str,
        error_message: str = None
    ):
        """
        Guarda el historial de exportación en la base de datos.

        Args:
            osm_file_path: Ruta del archivo OSM generado
            status: Estado de la exportación (success, error)
            error_message: Mensaje de error si aplica
        """
        cursor = self.db.get_cursor()

        # Contar nodos y ways
        stats = self.db.get_stats()

        cursor.execute("""
            INSERT INTO export_history
            (osm_file_path, total_nodes, total_ways, status, error_message)
            VALUES (?, ?, ?, ?, ?)
        """, (
            osm_file_path,
            stats.get('total_nodes', 0),
            stats.get('total_ways', 0),
            status,
            error_message
        ))

        self.db.commit()

    def validate_osm_data(self) -> Dict:
        """
        Valida que los datos sean correctos antes de exportar.

        Returns:
            Diccionario con resultados de validación:
            {
                'valid': bool,
                'errors': List[str],
                'warnings': List[str],
                'stats': Dict
            }
        """
        errors = []
        warnings = []

        # Obtener estadísticas
        stats = self.db.get_stats()

        # Validar que haya al menos algunos datos
        if stats.get('total_nodes', 0) == 0:
            errors.append("No hay nodos en la base de datos")

        if stats.get('total_ways', 0) == 0:
            errors.append("No hay calles (ways) en la base de datos")

        # Validar ways
        ways = self.way_model.get_all()

        for way in ways:
            # Cada way debe tener al menos 2 nodos
            if len(way['nodes']) < 2:
                errors.append(
                    f"Way {way['id']} ('{way.get('name', 'sin nombre')}') "
                    f"tiene solo {len(way['nodes'])} nodo(s). Mínimo: 2"
                )

            # Advertir si no tiene nombre
            if not way.get('name'):
                warnings.append(
                    f"Way {way['id']} no tiene nombre"
                )

            # Advertir sobre tipos de highway no estándar
            valid_highway_types = [
                'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
                'residential', 'service', 'road', 'unclassified',
                'living_street', 'pedestrian', 'track', 'path'
            ]

            if way.get('highway_type') not in valid_highway_types:
                warnings.append(
                    f"Way {way['id']} tiene tipo de highway no estándar: "
                    f"'{way.get('highway_type')}'"
                )

        # Validar nodos huérfanos (nodos que no pertenecen a ningún way)
        cursor = self.db.get_cursor()
        cursor.execute("""
            SELECT COUNT(*) as orphan_count
            FROM nodes
            WHERE id NOT IN (SELECT DISTINCT node_id FROM way_nodes)
        """)
        orphan_count = cursor.fetchone()['orphan_count']

        if orphan_count > 0:
            warnings.append(
                f"Hay {orphan_count} nodo(s) huérfano(s) "
                f"(no pertenecen a ninguna calle)"
            )

        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings,
            'stats': stats
        }

    def get_export_history(self, limit: int = 10) -> List[Dict]:
        """
        Obtiene el historial de exportaciones.

        Args:
            limit: Número de registros a retornar

        Returns:
            Lista de exportaciones anteriores
        """
        cursor = self.db.get_cursor()
        cursor.execute("""
            SELECT * FROM export_history
            ORDER BY export_date DESC
            LIMIT ?
        """, (limit,))

        return [dict(row) for row in cursor.fetchall()]


# ============================================================================
# FUNCIONES DE UTILIDAD
# ============================================================================

def export_database_to_osm(db_path: str = None, output_path: str = None) -> str:
    """
    Función helper para exportar la base de datos a OSM en un solo paso.

    Args:
        db_path: Ruta de la base de datos (None = por defecto)
        output_path: Ruta del archivo de salida (None = auto-generar)

    Returns:
        Ruta del archivo OSM generado
    """
    db = MapDatabase(db_path)
    exporter = OSMExporter(db)

    # Validar antes de exportar
    validation = exporter.validate_osm_data()

    print("\n" + "=" * 60)
    print("VALIDACIÓN DE DATOS OSM")
    print("=" * 60)

    if validation['errors']:
        print("\n❌ ERRORES:")
        for error in validation['errors']:
            print(f"  • {error}")

    if validation['warnings']:
        print("\n⚠️  ADVERTENCIAS:")
        for warning in validation['warnings']:
            print(f"  • {warning}")

    print(f"\n📊 ESTADÍSTICAS:")
    print(f"  • Nodos: {validation['stats'].get('total_nodes', 0)}")
    print(f"  • Calles: {validation['stats'].get('total_ways', 0)}")
    print(f"  • Tags: {validation['stats'].get('total_tags', 0)}")

    if not validation['valid']:
        print("\n❌ NO SE PUEDE EXPORTAR: Hay errores críticos")
        return None

    print("\n✓ Validación exitosa, procediendo a exportar...")
    print("=" * 60 + "\n")

    # Exportar
    output_file = exporter.export_to_osm_file(output_path)

    db.close()

    return output_file


if __name__ == '__main__':
    """
    Script de prueba: ejecuta la exportación desde línea de comandos
    """
    print("Exportador OSM - Editor de Mapas")
    print("=" * 60)

    output_file = export_database_to_osm()

    if output_file:
        print(f"\n✓ EXPORTACIÓN COMPLETADA")
        print(f"  Archivo: {output_file}")
        print(f"\nPróximos pasos:")
        print(f"  1. Procesar con OSRM:")
        print(f"     docker exec osrm osrm-extract -p /opt/car.lua {output_file}")
        print(f"     docker exec osrm osrm-contract {output_file.replace('.osm', '.osrm')}")
        print(f"  2. Reiniciar servicio OSRM")
    else:
        print(f"\n❌ EXPORTACIÓN FALLIDA")
