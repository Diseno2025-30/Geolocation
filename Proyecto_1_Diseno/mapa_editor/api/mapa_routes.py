"""
============================================================================
API REST PARA EDITOR DE MAPAS
============================================================================

Este módulo proporciona los endpoints REST para el editor de mapas.
Permite crear, leer, actualizar y eliminar nodos y calles.

Endpoints principales:

NODOS:
- GET    /api/mapa/nodes              - Obtener todos los nodos
- GET    /api/mapa/nodes/<id>         - Obtener un nodo específico
- POST   /api/mapa/nodes              - Crear nuevo nodo
- PUT    /api/mapa/nodes/<id>         - Actualizar nodo
- DELETE /api/mapa/nodes/<id>         - Eliminar nodo

CALLES (WAYS):
- GET    /api/mapa/ways               - Obtener todas las calles
- GET    /api/mapa/ways/<id>          - Obtener una calle específica
- POST   /api/mapa/ways               - Crear nueva calle
- PUT    /api/mapa/ways/<id>          - Actualizar calle
- DELETE /api/mapa/ways/<id>          - Eliminar calle

EXPORTACIÓN:
- GET    /api/mapa/export/geojson     - Exportar a GeoJSON
- POST   /api/mapa/export/osm         - Exportar a formato OSM
- POST   /api/mapa/export/osrm        - Exportar y actualizar OSRM

ESTADÍSTICAS:
- GET    /api/mapa/stats              - Estadísticas generales

============================================================================
"""

from flask import Blueprint, request, jsonify, send_file
import sys
import os

# Agregar path para imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.map_models import (
    MapDatabase, Node, Way, Tag,
    get_map_database, export_to_geojson
)
from services.osm_service import OSMExporter, export_database_to_osm
from services.osrm_integration import OSRMIntegration, full_update_workflow


# Crear Blueprint
mapa_api_bp = Blueprint('mapa_api', __name__, url_prefix='/api/mapa')

# Inicializar base de datos (singleton)
_db_instance = None

def get_db():
    """Obtiene la instancia de la base de datos (singleton)"""
    global _db_instance
    if _db_instance is None:
        _db_instance = get_map_database()
    return _db_instance


# ============================================================================
# ENDPOINTS DE NODOS
# ============================================================================

@mapa_api_bp.route('/nodes', methods=['GET'])
def get_nodes():
    """
    Obtiene todos los nodos.

    Query params:
        - limit: Límite de resultados (default: 1000)
        - lat, lon, radius: Búsqueda cercana a coordenadas
    """
    try:
        db = get_db()
        node_model = Node(db)

        # Búsqueda por proximidad
        lat = request.args.get('lat', type=float)
        lon = request.args.get('lon', type=float)
        radius = request.args.get('radius', type=float, default=0.001)

        if lat is not None and lon is not None:
            nodes = node_model.find_nearby(lat, lon, radius)
        else:
            limit = request.args.get('limit', type=int, default=1000)
            nodes = node_model.get_all(limit=limit)

        return jsonify({
            'success': True,
            'count': len(nodes),
            'nodes': nodes
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/nodes/<int:node_id>', methods=['GET'])
def get_node(node_id):
    """Obtiene un nodo específico por ID"""
    try:
        db = get_db()
        node_model = Node(db)
        node = node_model.get(node_id)

        if not node:
            return jsonify({
                'success': False,
                'error': 'Nodo no encontrado'
            }), 404

        return jsonify({
            'success': True,
            'node': node
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/nodes', methods=['POST'])
def create_node():
    """
    Crea un nuevo nodo.

    Body (JSON):
        {
            "lat": 11.0041,
            "lon": -74.8070,
            "osm_id": 12345 (opcional)
        }
    """
    try:
        data = request.get_json()

        if not data or 'lat' not in data or 'lon' not in data:
            return jsonify({
                'success': False,
                'error': 'Faltan campos requeridos: lat, lon'
            }), 400

        db = get_db()
        node_model = Node(db)

        node_id = node_model.create(
            lat=data['lat'],
            lon=data['lon'],
            osm_id=data.get('osm_id')
        )

        # Obtener el nodo creado
        node = node_model.get(node_id)

        return jsonify({
            'success': True,
            'message': 'Nodo creado exitosamente',
            'node': node
        }), 201

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/nodes/<int:node_id>', methods=['PUT'])
def update_node(node_id):
    """
    Actualiza un nodo existente.

    Body (JSON):
        {
            "lat": 11.0050 (opcional),
            "lon": -74.8080 (opcional)
        }
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({
                'success': False,
                'error': 'No se proporcionaron datos para actualizar'
            }), 400

        db = get_db()
        node_model = Node(db)

        success = node_model.update(
            node_id=node_id,
            lat=data.get('lat'),
            lon=data.get('lon')
        )

        if not success:
            return jsonify({
                'success': False,
                'error': 'Nodo no encontrado o no se pudo actualizar'
            }), 404

        node = node_model.get(node_id)

        return jsonify({
            'success': True,
            'message': 'Nodo actualizado exitosamente',
            'node': node
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/nodes/<int:node_id>', methods=['DELETE'])
def delete_node(node_id):
    """Elimina un nodo"""
    try:
        db = get_db()
        node_model = Node(db)

        success = node_model.delete(node_id)

        if not success:
            return jsonify({
                'success': False,
                'error': 'Nodo no encontrado'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Nodo eliminado exitosamente'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# ENDPOINTS DE CALLES (WAYS)
# ============================================================================

@mapa_api_bp.route('/ways', methods=['GET'])
def get_ways():
    """
    Obtiene todas las calles.

    Query params:
        - limit: Límite de resultados (default: 1000)
    """
    try:
        db = get_db()
        way_model = Way(db)

        limit = request.args.get('limit', type=int, default=1000)
        ways = way_model.get_all(limit=limit)

        return jsonify({
            'success': True,
            'count': len(ways),
            'ways': ways
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/ways/<int:way_id>', methods=['GET'])
def get_way(way_id):
    """Obtiene una calle específica por ID"""
    try:
        db = get_db()
        way_model = Way(db)
        way = way_model.get(way_id)

        if not way:
            return jsonify({
                'success': False,
                'error': 'Calle no encontrada'
            }), 404

        return jsonify({
            'success': True,
            'way': way
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/ways', methods=['POST'])
def create_way():
    """
    Crea una nueva calle.

    Body (JSON):
        {
            "node_ids": [1, 2, 3],          # IDs de nodos que forman la calle
            "name": "Calle Principal",      # opcional
            "highway_type": "primary",      # opcional (default: road)
            "oneway": false,                # opcional (default: false)
            "maxspeed": 60,                 # opcional
            "osm_id": 12345                 # opcional
        }
    """
    try:
        data = request.get_json()

        if not data or 'node_ids' not in data:
            return jsonify({
                'success': False,
                'error': 'Campo requerido: node_ids (array de IDs)'
            }), 400

        if len(data['node_ids']) < 2:
            return jsonify({
                'success': False,
                'error': 'Una calle debe tener al menos 2 nodos'
            }), 400

        db = get_db()
        way_model = Way(db)

        way_id = way_model.create(
            node_ids=data['node_ids'],
            name=data.get('name'),
            highway_type=data.get('highway_type', 'road'),
            oneway=data.get('oneway', False),
            maxspeed=data.get('maxspeed'),
            osm_id=data.get('osm_id')
        )

        # Obtener la calle creada
        way = way_model.get(way_id)

        return jsonify({
            'success': True,
            'message': 'Calle creada exitosamente',
            'way': way
        }), 201

    except ValueError as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/ways/<int:way_id>', methods=['PUT'])
def update_way(way_id):
    """
    Actualiza una calle existente.

    Body (JSON):
        {
            "name": "Nuevo Nombre",         # opcional
            "highway_type": "secondary",    # opcional
            "oneway": true,                 # opcional
            "maxspeed": 80,                 # opcional
            "node_ids": [1, 2, 3, 4]       # opcional (actualiza nodos)
        }
    """
    try:
        data = request.get_json()

        if not data:
            return jsonify({
                'success': False,
                'error': 'No se proporcionaron datos para actualizar'
            }), 400

        db = get_db()
        way_model = Way(db)

        # Actualizar metadatos de la calle
        if any(k in data for k in ['name', 'highway_type', 'oneway', 'maxspeed']):
            success = way_model.update(
                way_id=way_id,
                name=data.get('name'),
                highway_type=data.get('highway_type'),
                oneway=data.get('oneway'),
                maxspeed=data.get('maxspeed')
            )

            if not success:
                return jsonify({
                    'success': False,
                    'error': 'Calle no encontrada o no se pudo actualizar'
                }), 404

        # Actualizar nodos si se proporcionaron
        if 'node_ids' in data:
            if len(data['node_ids']) < 2:
                return jsonify({
                    'success': False,
                    'error': 'Una calle debe tener al menos 2 nodos'
                }), 400

            way_model.update_nodes(way_id, data['node_ids'])

        way = way_model.get(way_id)

        return jsonify({
            'success': True,
            'message': 'Calle actualizada exitosamente',
            'way': way
        })

    except ValueError as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/ways/<int:way_id>', methods=['DELETE'])
def delete_way(way_id):
    """Elimina una calle"""
    try:
        db = get_db()
        way_model = Way(db)

        success = way_model.delete(way_id)

        if not success:
            return jsonify({
                'success': False,
                'error': 'Calle no encontrada'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Calle eliminada exitosamente'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# ENDPOINTS DE EXPORTACIÓN
# ============================================================================

@mapa_api_bp.route('/export/geojson', methods=['GET'])
def export_geojson():
    """Exporta todas las calles en formato GeoJSON"""
    try:
        db = get_db()
        geojson = export_to_geojson(db)

        return jsonify(geojson)

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/export/osm', methods=['POST'])
def export_osm():
    """
    Exporta la base de datos a formato OSM XML.

    Returns:
        {
            "success": true,
            "file_path": "/path/to/export.osm",
            "stats": {...}
        }
    """
    try:
        db = get_db()
        exporter = OSMExporter(db)

        # Validar antes de exportar
        validation = exporter.validate_osm_data()

        if not validation['valid']:
            return jsonify({
                'success': False,
                'error': 'Errores de validación',
                'validation': validation
            }), 400

        # Exportar
        osm_file = exporter.export_to_osm_file()

        return jsonify({
            'success': True,
            'message': 'Exportación exitosa',
            'file_path': osm_file,
            'validation': validation
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/export/osrm', methods=['POST'])
def export_and_update_osrm():
    """
    Exporta la BD y actualiza OSRM Docker (proceso completo).

    Body (JSON - opcional):
        {
            "container_name": "osrm",       # Nombre del contenedor Docker
            "restart_service": false        # Si reiniciar el servicio
        }
    """
    try:
        data = request.get_json() or {}

        container_name = data.get('container_name', 'osrm')
        restart_service = data.get('restart_service', False)

        # Ejecutar flujo completo
        results = full_update_workflow(
            container_name=container_name,
            restart_service=restart_service
        )

        if results['success']:
            return jsonify({
                'success': True,
                'message': 'Mapa OSRM actualizado exitosamente',
                'results': results
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Fallo en la actualización de OSRM',
                'results': results
            }), 500

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# ENDPOINTS DE ESTADÍSTICAS
# ============================================================================

@mapa_api_bp.route('/stats', methods=['GET'])
def get_stats():
    """Obtiene estadísticas generales de la base de datos"""
    try:
        db = get_db()
        stats = db.get_stats()

        return jsonify({
            'success': True,
            'stats': stats
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@mapa_api_bp.route('/export/history', methods=['GET'])
def get_export_history():
    """Obtiene el historial de exportaciones"""
    try:
        db = get_db()
        exporter = OSMExporter(db)

        limit = request.args.get('limit', type=int, default=10)
        history = exporter.get_export_history(limit=limit)

        return jsonify({
            'success': True,
            'count': len(history),
            'history': history
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# ENDPOINT DE SALUD
# ============================================================================

@mapa_api_bp.route('/health', methods=['GET'])
def health_check():
    """Verifica que el servicio esté funcionando"""
    try:
        db = get_db()
        stats = db.get_stats()

        return jsonify({
            'success': True,
            'status': 'healthy',
            'stats': stats
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'status': 'unhealthy',
            'error': str(e)
        }), 500
