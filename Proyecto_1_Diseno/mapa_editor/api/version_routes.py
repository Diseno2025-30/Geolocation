"""
============================================================================
API REST PARA GESTIÓN DE VERSIONES DE MAPAS
============================================================================

Endpoints para crear, listar, comparar y eliminar versiones de mapas.

Endpoints:

VERSIONES:
- GET    /api/mapa/versions              - Listar todas las versiones
- GET    /api/mapa/versions/<id>         - Obtener una versión específica
- POST   /api/mapa/versions              - Crear nueva versión
- PUT    /api/mapa/versions/<id>         - Actualizar versión
- DELETE /api/mapa/versions/<id>         - Eliminar versión
- POST   /api/mapa/versions/<id>/activate - Activar versión
- POST   /api/mapa/versions/<id>/clone    - Clonar versión

COMPARACIÓN:
- GET    /api/mapa/versions/compare       - Comparar dos versiones

============================================================================
"""

from flask import Blueprint, request, jsonify
import sys
import os

# Agregar path para imports
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.map_models import MapDatabase, get_map_database
from models.version_models import MapVersion, VersionManager


# Crear Blueprint
version_api_bp = Blueprint('version_api', __name__, url_prefix='/api/mapa/versions')

# Base de datos
_db_instance = None

def get_db():
    """Obtiene la instancia de la base de datos (singleton)"""
    global _db_instance
    if _db_instance is None:
        _db_instance = get_map_database()
    return _db_instance


# ============================================================================
# ENDPOINTS DE VERSIONES
# ============================================================================

@version_api_bp.route('', methods=['GET'])
def get_versions():
    """
    Obtiene todas las versiones con estadísticas.

    Returns:
        {
            "success": true,
            "count": 3,
            "active_version": {...},
            "versions": [...]
        }
    """
    try:
        db = get_db()
        manager = VersionManager(db)

        summary = manager.get_summary()

        return jsonify({
            'success': True,
            'count': summary['total_versions'],
            'active_version': summary['active_version'],
            'versions': summary['versions']
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@version_api_bp.route('/<int:version_id>', methods=['GET'])
def get_version(version_id):
    """Obtiene una versión específica por ID"""
    try:
        db = get_db()
        version_model = MapVersion(db)

        version = version_model.get(version_id)

        if not version:
            return jsonify({
                'success': False,
                'error': 'Versión no encontrada'
            }), 404

        return jsonify({
            'success': True,
            'version': version
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@version_api_bp.route('', methods=['POST'])
def create_version():
    """
    Crea una nueva versión.

    Body (JSON):
        {
            "name": "Puerto v1",                # Requerido
            "description": "Primera versión",   # Opcional
            "clone_from_active": true,          # Si clonar de la versión activa
            "is_active": false                  # Si activar inmediatamente
        }
    """
    try:
        data = request.get_json()

        if not data or 'name' not in data:
            return jsonify({
                'success': False,
                'error': 'Campo requerido: name'
            }), 400

        db = get_db()

        if data.get('clone_from_active', False):
            # Clonar desde versión activa
            manager = VersionManager(db)
            version_id = manager.create_version_from_current(
                name=data['name'],
                description=data.get('description')
            )
        else:
            # Crear versión vacía
            version_model = MapVersion(db)
            version_id = version_model.create(
                name=data['name'],
                description=data.get('description'),
                is_active=data.get('is_active', False)
            )

        # Obtener la versión creada
        version_model = MapVersion(db)
        version = version_model.get(version_id)

        return jsonify({
            'success': True,
            'message': 'Versión creada exitosamente',
            'version': version
        }), 201

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@version_api_bp.route('/<int:version_id>', methods=['PUT'])
def update_version(version_id):
    """
    Actualiza una versión.

    Body (JSON):
        {
            "name": "Nuevo nombre",           # Opcional
            "description": "Nueva descripción" # Opcional
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
        version_model = MapVersion(db)

        success = version_model.update(
            version_id=version_id,
            name=data.get('name'),
            description=data.get('description')
        )

        if not success:
            return jsonify({
                'success': False,
                'error': 'Versión no encontrada o no se pudo actualizar'
            }), 404

        version = version_model.get(version_id)

        return jsonify({
            'success': True,
            'message': 'Versión actualizada exitosamente',
            'version': version
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@version_api_bp.route('/<int:version_id>', methods=['DELETE'])
def delete_version(version_id):
    """
    Elimina una versión.

    Query params:
        - cascade: Si eliminar también nodos/ways (default: false)
    """
    try:
        cascade = request.args.get('cascade', 'false').lower() == 'true'

        db = get_db()
        version_model = MapVersion(db)

        success = version_model.delete(version_id, cascade=cascade)

        if not success:
            return jsonify({
                'success': False,
                'error': 'Versión no encontrada o es la versión activa'
            }), 404

        return jsonify({
            'success': True,
            'message': 'Versión eliminada exitosamente'
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@version_api_bp.route('/<int:version_id>/activate', methods=['POST'])
def activate_version(version_id):
    """Activa una versión (desactiva todas las demás)"""
    try:
        db = get_db()
        version_model = MapVersion(db)

        success = version_model.activate(version_id)

        if not success:
            return jsonify({
                'success': False,
                'error': 'Versión no encontrada'
            }), 404

        version = version_model.get(version_id)

        return jsonify({
            'success': True,
            'message': f'Versión "{version["name"]}" activada',
            'version': version
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@version_api_bp.route('/<int:version_id>/clone', methods=['POST'])
def clone_version(version_id):
    """
    Clona una versión existente.

    Body (JSON):
        {
            "name": "Nombre del clon",          # Requerido
            "description": "Descripción"        # Opcional
        }
    """
    try:
        data = request.get_json()

        if not data or 'name' not in data:
            return jsonify({
                'success': False,
                'error': 'Campo requerido: name'
            }), 400

        db = get_db()
        version_model = MapVersion(db)

        new_version_id = version_model.clone(
            source_version_id=version_id,
            new_name=data['name'],
            new_description=data.get('description')
        )

        new_version = version_model.get(new_version_id)

        return jsonify({
            'success': True,
            'message': 'Versión clonada exitosamente',
            'version': new_version
        }), 201

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


# ============================================================================
# COMPARACIÓN DE VERSIONES
# ============================================================================

@version_api_bp.route('/compare', methods=['GET'])
def compare_versions():
    """
    Compara dos versiones.

    Query params:
        - v1: ID de la primera versión
        - v2: ID de la segunda versión

    Returns:
        {
            "success": true,
            "comparison": {
                "only_in_version_1": [...],
                "only_in_version_2": [...],
                "added_count": 10,
                "removed_count": 5
            }
        }
    """
    try:
        v1 = request.args.get('v1', type=int)
        v2 = request.args.get('v2', type=int)

        if not v1 or not v2:
            return jsonify({
                'success': False,
                'error': 'Se requieren los parámetros v1 y v2'
            }), 400

        db = get_db()
        manager = VersionManager(db)

        comparison = manager.compare_versions(v1, v2)

        return jsonify({
            'success': True,
            'comparison': comparison
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
