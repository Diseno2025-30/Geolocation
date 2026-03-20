# app/routes_api.py
from flask import Blueprint, jsonify, request, current_app, Response
from app.database import (
    get_last_coordinate, get_historical_by_date,
    get_historical_by_range, get_historical_by_geofence,
    get_db, get_active_devices, get_last_coordinate_by_user, get_congestion_segments,
    get_empresas_from_usuarios, get_rutas_by_empresa, get_all_rutas,
    insert_ruta, update_ruta, delete_ruta,
    get_segment_coords, get_multiple_segment_coords, insert_segment_coords,
    get_registered_buildings
)
from app.utils import get_git_info
from app.services_osrm import check_osrm_available
from datetime import datetime
from app.services.services_buildings import recalculate_building
from app.config import TILESERVER_HOST
import requests
import logging
import json
import os


logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


api_bp = Blueprint('api', __name__)

# ===== ALMACENAMIENTO EN MEMORIA PARA DESTINOS =====
# Diccionario para almacenar destinos pendientes por user_id
pending_destinations = {}


def recalculate_building_endpoint():
    try:
        data = request.json

        if not data:
            return jsonify({
                "success": False,
                "error": "Body JSON requerido"
            }), 400

        building_osm_id = data.get('building_osm_id')

        if not building_osm_id:
            return jsonify({
                "success": False,
                "error": "building_osm_id requerido"
            }), 400

        log.info(f"Recalculando edificio OSM ID: {building_osm_id}")

        result = recalculate_building(building_osm_id)

        return jsonify({
            "success": True,
            "building": result
        })

    except ValueError as e:
        log.error(f"ValueError en recalculate_building: {e}")
        return jsonify({
            "success": False,
            "error": str(e)
        }), 404

    except Exception as e:
        log.error(f"Error en recalculate_building: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


# ===== ENDPOINTS DE API (Producción y Test) =====
def get_segment_from_coords():
    """Obtiene segment_id para coordenadas específicas."""
    try:
        lat = float(request.args.get('lat'))
        lon = float(request.args.get('lon'))
        
        if not lat or not lon:
            return jsonify({'success': False, 'error': 'Se requieren lat y lon'}), 400
        
        # Usar tu función existente (mejorada)
        from app.services_osrm import snap_to_road
        snapped_lat, snapped_lon, segment_info = snap_to_road(lat, lon)
        
        if segment_info:
            return jsonify({
                'success': True,
                'original_coords': {'lat': lat, 'lon': lon},
                'snapped_coords': {'lat': snapped_lat, 'lon': snapped_lon},
                'segment': segment_info
            })
        else:
            return jsonify({
                'success': False,
                'error': 'No se pudo encontrar segmento para estas coordenadas'
            }), 404
            
    except ValueError:
        return jsonify({'success': False, 'error': 'Coordenadas inválidas'}), 400
    except Exception as e:
        log.error(f"Error obteniendo segmento: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _register_user():
    """Endpoint para registrar usuarios vía HTTPS (seguro)"""
    try:
        data = request.json
        user_id = data.get('user_id')
        cedula = data.get('cedula')
        nombre_completo = data.get('nombre_completo')
        email = data.get('email')
        telefono = data.get('telefono')
        empresa = data.get('empresa')
        
        if not all([user_id, cedula, nombre_completo, email]):
            return jsonify({
                'success': False,
                'error': 'Faltan campos obligatorios: user_id, cedula, nombre_completo, email'
            }), 400
        
        # Guardar en BD usando la función que ya existe
        from app.database import insert_user_registration
        insert_user_registration(user_id, cedula, nombre_completo, email, telefono, empresa)
        
        return jsonify({
            'success': True,
            'message': 'Usuario registrado exitosamente',
            'user_id': user_id
        })
        
    except Exception as e:
        print(f"Error registrando usuario: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def get_registered_users():
    """Obtiene la lista de user_id únicos registrados en la base de datos."""
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Obtener todos los user_id únicos de la tabla coordinates
        cursor.execute('SELECT DISTINCT user_id FROM coordinates WHERE user_id IS NOT NULL ORDER BY user_id')
        users = cursor.fetchall()

        conn.close()

        # Convertir a lista simple de user_ids
        user_list = [user[0] for user in users]

        return jsonify({'users': user_list, 'count': len(user_list)})
    except Exception as e:
        print(f"Error obteniendo usuarios registrados: {e}")
        return jsonify({'users': [], 'count': 0}), 500

def _get_coordenadas():
    return jsonify(get_last_coordinate())

def _get_historico(fecha):
    try:
        user_id = request.args.get('user_id')
        
        year, month, day = fecha.split('-')
        fecha_formateada = f"{day}/{month}/{year}"
        
        coordenadas = get_historical_by_date(fecha_formateada, user_id=user_id)
        return jsonify(coordenadas)
    except Exception as e:
        print(f"Error en consulta histórica: {e}")
        return jsonify([]), 500

def _get_historico_rango():
    try:
        fecha_inicio_str = request.args.get('inicio')
        hora_inicio_str = request.args.get('hora_inicio', '00:00')
        fecha_fin_str = request.args.get('fin')
        hora_fin_str = request.args.get('hora_fin', '23:59')

        user_id = request.args.get('user_id')  # Single user (legacy)
        user_ids_str = request.args.get('user_ids')  # Multiple users (new)

        if not fecha_inicio_str or not fecha_fin_str:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400

        start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
        end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M').replace(second=59)

        if start_datetime > end_datetime:
            return jsonify({'error': 'La fecha/hora de inicio debe ser anterior a la fecha/hora de fin'}), 400

        # Procesar múltiples user_ids si están presentes
        user_ids = None
        if user_ids_str:
            user_ids = [uid.strip() for uid in user_ids_str.split(',') if uid.strip()]

        coordenadas = get_historical_by_range(start_datetime, end_datetime, user_id=user_id, user_ids=user_ids)
        return jsonify(coordenadas)

    except ValueError:
        return jsonify({'error': 'Formato de fecha u hora inválido. Use YYYY-MM-DD y HH:MM'}), 400
    except Exception as e:
        print(f"Error en consulta histórica por rango: {e}")
        return jsonify({'error': 'Error interno del servidor'}), 500

def _get_historico_geocerca():
    try:
        min_lat = float(request.args.get('min_lat'))
        min_lon = float(request.args.get('min_lon'))
        max_lat = float(request.args.get('max_lat'))
        max_lon = float(request.args.get('max_lon'))

        user_id = request.args.get('user_id')  # Single user (legacy)
        user_ids_str = request.args.get('user_ids')  # Multiple users (new)

        # Parámetros opcionales de tiempo
        fecha_inicio_str = request.args.get('inicio')
        hora_inicio_str = request.args.get('hora_inicio', '00:00')
        fecha_fin_str = request.args.get('fin')
        hora_fin_str = request.args.get('hora_fin', '23:59')

        # Procesar múltiples user_ids si están presentes
        user_ids = None
        if user_ids_str:
            user_ids = [uid.strip() for uid in user_ids_str.split(',') if uid.strip()]

        # Procesar fechas si están presentes
        start_datetime = None
        end_datetime = None
        if fecha_inicio_str and fecha_fin_str:
            start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
            end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M').replace(second=59)

        coordenadas = get_historical_by_geofence(
            min_lat, max_lat, min_lon, max_lon,
            user_id=user_id,
            user_ids=user_ids,
            start_datetime=start_datetime,
            end_datetime=end_datetime
        )
        return jsonify(coordenadas)
    except Exception as e:
        print(f"Error en consulta por geocerca: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': 'Error interno del servidor o parámetros inválidos'}), 500

def _osrm_proxy(params):
    try:
        url = f"http://localhost:5001/route/v1/driving/{params}"
        response = requests.get(url, params=request.args, timeout=5)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({'error': str(e), 'code': 'Error'}), 500

def _tile_proxy(z, x, y):
    """Proxy para tiles del tile server local (overv/openstreetmap-tile-server)."""
    try:
        url = f"{TILESERVER_HOST}/tile/{z}/{x}/{y}.png"
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            return Response(resp.content, content_type='image/png',
                          headers={'Cache-Control': 'public, max-age=604800'})
        else:
            return Response(b'', status=resp.status_code)
    except Exception as e:
        log.error(f"Error en tile proxy: {e}")
        return Response(b'', status=502)

def _get_active_devices():
    """Retorna dispositivos activos (últimos 2 minutos)."""
    try:
        devices = get_active_devices()
        return jsonify(devices)
    except Exception as e:
        print(f"Error obteniendo dispositivos activos: {e}")
        import traceback
        traceback.print_exc()
        return jsonify([]), 500


def _send_destination():
    """Guarda un destino único para enviar a la app"""
    try:
        data = request.json
        user_id = data.get('user_id')
        latitude = data.get('latitude')
        longitude = data.get('longitude')
        
        if not user_id or latitude is None or longitude is None:
            return jsonify({'success': False, 'error': 'Parámetros incompletos'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # ✅ NUEVO: Cancelar destinos pendientes anteriores
        cursor.execute('''
            UPDATE destinations 
            SET status = 'cancelled' 
            WHERE user_id = %s AND status IN ('pending', 'sent')
        ''', (user_id,))
        
        # Insertar con order_index = 0 (destino único)
        cursor.execute('''
            INSERT INTO destinations (user_id, latitude, longitude, status, order_index)
            VALUES (%s, %s, %s, 'pending', 0)
            RETURNING id, created_at
        ''', (user_id, latitude, longitude))
        
        result = cursor.fetchone()
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Destino guardado',
            'destination_id': result[0],
            'created_at': result[1].strftime('%d/%m/%Y %H:%M:%S')
        })
        
    except Exception as e:
        print(f"Error enviando destino: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def get_user_destinations(user_id):
    """Obtiene los destinos de un usuario con información de secuencia."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # ✅ Incluir los nuevos campos (con COALESCE para compatibilidad)
        cursor.execute('''
            SELECT id, latitude, longitude, status, created_at,
                   COALESCE(order_index, 0) as order_index,
                   route_id,
                   building_name
            FROM destinations 
            WHERE user_id = %s 
              AND created_at >= NOW() - INTERVAL '2 hours'
              AND status != 'cancelled'
            ORDER BY order_index ASC, created_at ASC
        ''', (user_id,))
        
        results = cursor.fetchall()
        conn.close()
        
        destinations = []
        for row in results:
            destinations.append({
                'id': row[0],
                'latitude': float(row[1]),
                'longitude': float(row[2]),
                'status': row[3],
                'created_at': row[4].strftime('%d/%m/%Y %H:%M:%S'),
                'order_index': row[5] if row[5] is not None else 0,
                'route_id': row[6],
                'building_name': row[7]
            })
        
        pending_count = sum(1 for d in destinations if d['status'] in ('pending', 'sent'))
        completed_count = sum(1 for d in destinations if d['status'] == 'completed')
        total_in_route = len(destinations)

        return jsonify({
            'success': True,
            'user_id': user_id,
            'destinations': destinations,
            'count': len(destinations),
            'pending_count': pending_count,
            'completed_count': completed_count,
            'total_in_route': total_in_route,
            'route_progress': f"{completed_count}/{total_in_route}" if total_in_route > 0 else "0/0"
        })
        
    except Exception as e:
        print(f"Error obteniendo destinos: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_route_progress(user_id):
    """Obtiene el progreso actual de la ruta de un usuario."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Obtener todos los destinos activos (no cancelados) del usuario
        cursor.execute('''
            SELECT id, latitude, longitude, status, order_index, route_id, building_name
            FROM destinations 
            WHERE user_id = %s 
              AND status != 'cancelled'
              AND created_at >= NOW() - INTERVAL '2 hours'
            ORDER BY order_index ASC
        ''', (user_id,))
        
        results = cursor.fetchall()
        conn.close()
        
        if not results:
            return jsonify({
                'success': True,
                'has_route': False,
                'message': 'Sin ruta activa'
            })
        
        steps = []
        current_step = None
        for row in results:
            step = {
                'id': row[0],
                'latitude': float(row[1]),
                'longitude': float(row[2]),
                'status': row[3],
                'order_index': row[4] if row[4] is not None else 0,
                'route_id': row[5],
                'building_name': row[6]
            }
            steps.append(step)
            
            # El paso actual es el primero que sea pending o sent
            if current_step is None and step['status'] in ('pending', 'sent'):
                current_step = step
        
        completed = sum(1 for s in steps if s['status'] == 'completed')
        total = len(steps)
        
        return jsonify({
            'success': True,
            'has_route': True,
            'user_id': user_id,
            'current_step': current_step,
            'completed': completed,
            'total': total,
            'progress_text': f"{completed}/{total}",
            'route_complete': completed == total,
            'steps': steps
        })
        
    except Exception as e:
        log.error(f"Error obteniendo progreso: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_destination(user_id):
    """La app consulta su PRÓXIMO destino pendiente (el primero en la cola)."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # ✅ CAMBIO CLAVE: ORDER BY order_index ASC (primero en la cola)
        cursor.execute('''
            SELECT id, latitude, longitude, created_at
            FROM destinations 
            WHERE user_id = %s 
              AND status = 'pending'
            ORDER BY order_index ASC, created_at ASC
            LIMIT 1
        ''', (user_id,))
        
        result = cursor.fetchone()
        
        if result:
            cursor.execute('''
                UPDATE destinations 
                SET status = 'sent' 
                WHERE id = %s
            ''', (result[0],))
            conn.commit()
            
            destination = {
                'lat': float(result[1]),
                'lon': float(result[2]),
                'timestamp': result[3].strftime('%d/%m/%Y %H:%M:%S')
            }
            
            conn.close()
            return jsonify({
                'has_destination': True,
                'destination': destination
            })
        
        conn.close()
        return jsonify({'has_destination': False})
        
    except Exception as e:
        return jsonify({'has_destination': False, 'error': str(e)}), 500


def _complete_destination():
    """Marca el destino ACTUAL como completado y retorna el progreso de la ruta."""
    try:
        data = request.json
        user_id = data.get('user_id')
        
        if not user_id:
            return jsonify({'success': False, 'error': 'user_id requerido'}), 400
        
        conn = get_db()
        cursor = conn.cursor()
        
        # ✅ Completar el destino con menor order_index (el actual en la secuencia)
        cursor.execute('''
            UPDATE destinations 
            SET status = 'completed', completed_at = NOW()
            WHERE user_id = %s 
              AND status IN ('pending', 'sent')
              AND id = (
                  SELECT id FROM destinations 
                  WHERE user_id = %s AND status IN ('pending', 'sent')
                  ORDER BY order_index ASC, created_at ASC
                  LIMIT 1
              )
            RETURNING id, order_index, route_id
        ''', (user_id, user_id))
        
        result = cursor.fetchone()
        
        if not result:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'No se encontró destino pendiente'
            }), 404
        
        completed_id = result[0]
        completed_order = result[1]
        route_id = result[2]
        
        # ✅ NUEVO: Contar destinos restantes y totales para esta ruta
        if route_id:
            cursor.execute('''
                SELECT COUNT(*) FROM destinations 
                WHERE user_id = %s AND route_id = %s AND status IN ('pending', 'sent')
            ''', (user_id, route_id))
            remaining = cursor.fetchone()[0]
            
            cursor.execute('''
                SELECT COUNT(*) FROM destinations 
                WHERE user_id = %s AND route_id = %s
            ''', (user_id, route_id))
            total = cursor.fetchone()[0]
        else:
            remaining = 0
            total = 1
        
        conn.commit()
        conn.close()
        
        completed_step = total - remaining
        route_complete = remaining == 0
        
        log.info(f"🏁 Destino {completed_id} completado. Progreso: {completed_step}/{total}. Restantes: {remaining}")
        
        return jsonify({
            'success': True,
            'message': 'Destino completado',
            'destination_id': completed_id,
            'route_progress': {
                'completed_step': completed_step,
                'total_steps': total,
                'remaining': remaining,
                'route_complete': route_complete,
                'route_id': route_id
            }
        })
        
    except Exception as e:
        print(f"Error completando destino: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_user_location(user_id):
    """Obtiene la última ubicación de un usuario específico."""
    return jsonify(get_last_coordinate_by_user(user_id))

def get_congestion():
    """Obtiene segmentos con congestión (2+ vehículos)."""
    try:
        time_window = int(request.args.get('time_window'))
        congestion_data = get_congestion_segments(time_window)
        
        return jsonify({
            'success': True,
            'congestion': congestion_data,
            'total': len(congestion_data)
        })
    except Exception as e:
        log.error(f"Error en endpoint de congestión: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _get_empresas():
    """Obtiene lista de empresas registradas."""
    try:
        empresas = get_empresas_from_usuarios()
        return jsonify({
            'success': True,
            'empresas': empresas,
            'count': len(empresas)
        })
    except Exception as e:
        print(f"Error obteniendo empresas: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _get_rutas():
    """Obtiene rutas filtradas por empresa (opcional)."""
    try:
        empresa = request.args.get('empresa')
        
        if empresa:
            rutas = get_rutas_by_empresa(empresa)
        else:
            rutas = get_all_rutas()
        
        return jsonify({
            'success': True,
            'rutas': rutas,
            'count': len(rutas)
        })
    except Exception as e:
        print(f"Error obteniendo rutas: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _create_ruta():
    """Crea una nueva ruta preestablecida."""
    try:
        data = request.json
        nombre_ruta = data.get('nombre_ruta')
        empresa = data.get('empresa')
        segment_ids = data.get('segment_ids')  # String separado por comas
        descripcion = data.get('descripcion')
        
        if not nombre_ruta or not empresa or not segment_ids:
            return jsonify({
                'success': False,
                'error': 'Faltan campos requeridos: nombre_ruta, empresa, segment_ids'
            }), 400
        
        ruta_id = insert_ruta(nombre_ruta, empresa, segment_ids, descripcion)
        
        return jsonify({
            'success': True,
            'message': 'Ruta creada exitosamente',
            'ruta_id': ruta_id
        })
    except Exception as e:
        print(f"Error creando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _update_ruta(ruta_id):
    """Actualiza una ruta existente."""
    try:
        data = request.json
        nombre_ruta = data.get('nombre_ruta')
        segment_ids = data.get('segment_ids')
        descripcion = data.get('descripcion')
        
        success = update_ruta(ruta_id, nombre_ruta, segment_ids, descripcion)
        
        if success:
            return jsonify({
                'success': True,
                'message': 'Ruta actualizada exitosamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Error actualizando ruta'
            }), 500
    except Exception as e:
        print(f"Error actualizando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

def _delete_ruta(ruta_id):
    """Desactiva una ruta."""
    try:
        success = delete_ruta(ruta_id)

        if success:
            return jsonify({
                'success': True,
                'message': 'Ruta desactivada exitosamente'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Error desactivando ruta'
            }), 500
    except Exception as e:
        print(f"Error desactivando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_buildings():
    """Obtiene todos los edificios desde registered_buildings."""
    try:
        buildings = sorted(
            [{'id': str(r['osm_id']), 'name': r['name'], 'osm_id': r['osm_id']}
             for r in get_registered_buildings()],
            key=lambda b: b['name'].lower()
        )
        return jsonify({'success': True, 'buildings': buildings, 'count': len(buildings)})
    except Exception as e:
        print(f"Error obteniendo edificios: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _search_buildings():
    """Busca edificios por nombre desde registered_buildings."""
    try:
        query = request.args.get('q', '').lower().strip()

        buildings = sorted(
            [{'id': str(r['osm_id']), 'name': r['name'], 'osm_id': r['osm_id']}
             for r in get_registered_buildings()],
            key=lambda b: b['name'].lower()
        )

        if not query:
            return jsonify({'success': True, 'buildings': buildings, 'count': len(buildings)})

        filtered = [b for b in buildings if query in b['name'].lower()]
        return jsonify({'success': True, 'buildings': filtered, 'count': len(filtered)})
    except Exception as e:
        print(f"Error buscando edificios: {e}")
        return jsonify({'success': False, 'error': str(e), 'buildings': []}), 500


# ==================== SEGMENT COORDS ====================

def _get_segment_coords(segment_id):
    """Obtiene las coordenadas de un segment_id."""
    try:
        coords = get_segment_coords(segment_id)

        if coords:
            return jsonify({
                'success': True,
                'segment': coords
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Segment {segment_id} no encontrado'
            }), 404
    except Exception as e:
        log.error(f"Error obteniendo segment_coords: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_multiple_segment_coords():
    """Obtiene coordenadas de múltiples segment_ids."""
    try:
        data = request.json
        segment_ids = data.get('segment_ids', [])

        if not segment_ids:
            return jsonify({
                'success': False,
                'error': 'segment_ids requerido'
            }), 400

        coords = get_multiple_segment_coords(segment_ids)

        return jsonify({
            'success': True,
            'segments': coords,
            'found': len(coords),
            'requested': len(segment_ids)
        })
    except Exception as e:
        log.error(f"Error obteniendo múltiples segment_coords: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _save_segment_coords():
    """Guarda coordenadas de un segment_id si no existe."""
    try:
        data = request.json

        segment_id = data.get('segment_id')
        lat = data.get('lat')
        lon = data.get('lon')
        street_name = data.get('street_name', 'Sin nombre')
        building_name = data.get('building_name')

        if not segment_id or lat is None or lon is None:
            return jsonify({
                'success': False,
                'error': 'segment_id, lat y lon son requeridos'
            }), 400

        inserted = insert_segment_coords(segment_id, lat, lon, street_name, building_name)

        return jsonify({
            'success': True,
            'inserted': inserted,
            'segment_id': segment_id
        })
    except Exception as e:
        log.error(f"Error guardando segment_coords: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_ruta_waypoints(ruta_id):
    """Obtiene los waypoints (coordenadas) de una ruta preestablecida."""
    try:
        conn = get_db()
        cursor = conn.cursor()

        # Obtener la ruta
        cursor.execute(
            """SELECT id, nombre_ruta, empresa, segment_ids, descripcion
            FROM rutas
            WHERE id = %s AND activa = TRUE
            """,
            (ruta_id,)
        )
        ruta = cursor.fetchone()
        conn.close()

        if not ruta:
            return jsonify({
                'success': False,
                'error': f'Ruta {ruta_id} no encontrada'
            }), 404

        # Parsear segment_ids
        segment_ids = [s.strip() for s in ruta[3].split(',') if s.strip()]

        if not segment_ids:
            return jsonify({
                'success': False,
                'error': 'La ruta no tiene segmentos'
            }), 400

        # Obtener coordenadas de cada segment
        coords = get_multiple_segment_coords(segment_ids)

        # Construir waypoints en orden
        waypoints = []
        missing_segments = []

        for segment_id in segment_ids:
            if segment_id in coords:
                seg = coords[segment_id]
                waypoints.append({
                    'segment_id': segment_id,
                    'lat': seg['lat'],
                    'lon': seg['lon'],
                    'street_name': seg['street_name'],
                    'building_name': seg['building_name']
                })
            else:
                missing_segments.append(segment_id)

        return jsonify({
            'success': True,
            'ruta': {
                'id': ruta[0],
                'nombre': ruta[1],
                'empresa': ruta[2],
                'descripcion': ruta[4]
            },
            'waypoints': waypoints,
            'total_waypoints': len(waypoints),
            'missing_segments': missing_segments
        })
    except Exception as e:
        log.error(f"Error obteniendo waypoints de ruta {ruta_id}: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _assign_route_to_device():
    """Asigna una ruta preestablecida a un dispositivo (guarda todos los waypoints EN ORDEN)."""
    try:
        data = request.json
        user_id = data.get('user_id')
        ruta_id = data.get('ruta_id')

        if not user_id or not ruta_id:
            return jsonify({
                'success': False,
                'error': 'user_id y ruta_id son requeridos'
            }), 400

        conn = get_db()
        cursor = conn.cursor()

        # Obtener waypoints de la ruta
        cursor.execute(
            "SELECT segment_ids FROM rutas WHERE id = %s AND activa = TRUE",
            (ruta_id,)
        )
        result = cursor.fetchone()

        if not result:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Ruta no encontrada'
            }), 404

        segment_ids = [s.strip() for s in result[0].split(',') if s.strip()]
        coords = get_multiple_segment_coords(segment_ids)

        # ✅ NUEVO: Cancelar destinos pendientes anteriores de este usuario
        cursor.execute('''
            UPDATE destinations 
            SET status = 'cancelled' 
            WHERE user_id = %s AND status IN ('pending', 'sent')
        ''', (user_id,))
        cancelled = cursor.rowcount
        if cancelled > 0:
            log.info(f"⚠️ Cancelados {cancelled} destinos anteriores de {user_id}")

        # ✅ NUEVO: Insertar cada waypoint CON order_index y route_id
        inserted_count = 0
        for idx, segment_id in enumerate(segment_ids):
            if segment_id in coords:
                seg = coords[segment_id]
                cursor.execute('''
                    INSERT INTO destinations 
                    (user_id, latitude, longitude, status, order_index, route_id, building_name)
                    VALUES (%s, %s, %s, 'pending', %s, %s, %s)
                ''', (user_id, seg['lat'], seg['lon'], idx, ruta_id, seg.get('building_name')))
                inserted_count += 1

        conn.commit()
        conn.close()

        log.info(f"✓ Ruta {ruta_id} asignada a {user_id}: {inserted_count} waypoints en secuencia")

        return jsonify({
            'success': True,
            'message': f'Ruta asignada con {inserted_count} paradas secuenciales',
            'user_id': user_id,
            'ruta_id': ruta_id,
            'waypoints_count': inserted_count
        })
    except Exception as e:
        log.error(f"Error asignando ruta: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _debug_usuarios():
    """DEBUG: Ver todos los usuarios y empresas registradas"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Ver todos los usuarios
        cursor.execute("""
            SELECT user_id, cedula, nombre_completo, email, telefono, empresa, created_at, updated_at
            FROM usuarios_web 
            ORDER BY created_at DESC
        """)
        users = cursor.fetchall()
        
        usuarios_list = []
        empresas_set = set()
        
        for user in users:
            empresa = user[5] if user[5] else "[SIN EMPRESA]"
            if user[5]:
                empresas_set.add(user[5])
            
            usuarios_list.append({
                'user_id': user[0],
                'cedula': user[1],
                'nombre_completo': user[2],
                'email': user[3],
                'telefono': user[4],
                'empresa': empresa,
                'created_at': user[6].strftime('%d/%m/%Y %H:%M:%S') if user[6] else None,
                'updated_at': user[7].strftime('%d/%m/%Y %H:%M:%S') if user[7] else None
            })
        
        # Estadísticas
        cursor.execute("SELECT COUNT(*) FROM usuarios_web")
        total_usuarios = cursor.fetchone()[0]
        
        cursor.execute("SELECT COUNT(*) FROM usuarios_web WHERE empresa IS NOT NULL AND empresa != ''")
        usuarios_con_empresa = cursor.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'total_usuarios': total_usuarios,
            'usuarios_con_empresa': usuarios_con_empresa,
            'usuarios_sin_empresa': total_usuarios - usuarios_con_empresa,
            'empresas_unicas': sorted(list(empresas_set)),
            'count_empresas': len(empresas_set),
            'usuarios': usuarios_list
        })
        
    except Exception as e:
        print(f"Error en debug usuarios: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Rutas de Producción ---

@api_bp.route('/api/buildings/recalculate', methods=['POST'])
def recalculate_building_api():
    return recalculate_building_endpoint()

@api_bp.route('/api/buildings', methods=['GET'])
def get_buildings():
    return _get_buildings()

@api_bp.route('/api/buildings/search', methods=['GET'])
def search_buildings():
    return _search_buildings()

@api_bp.route('/api/users/registered')
def registered_users():
    return get_registered_users()

@api_bp.route('/api/congestion', methods=['GET'])
def congestion_consult():
    return get_congestion()

@api_bp.route('/coordenadas')
def coordenadas():
    return _get_coordenadas()

@api_bp.route('/historico/<fecha>')
def get_historico(fecha):
    return _get_historico(fecha)

@api_bp.route('/historico/rango')
def get_historico_rango():
    return _get_historico_rango()

@api_bp.route('/historico/geocerca')
def get_historico_geocerca():
    return _get_historico_geocerca()

@api_bp.route('/osrm/route/<path:params>')
def osrm_proxy(params):
    return _osrm_proxy(params)

@api_bp.route('/tiles/<int:z>/<int:x>/<int:y>.png')
def tile_proxy(z, x, y):
    return _tile_proxy(z, x, y)

@api_bp.route('/api/devices/active')
def active_devices():
    return _get_active_devices()

@api_bp.route('/api/destination/send', methods=['POST'])
def send_destination():
    return _send_destination()

@api_bp.route('/consult/destination/get/<user_id>')
def get_destination(user_id):
    return _get_destination(user_id)

@api_bp.route('/database/destination/<user_id>')
def save_destinations(user_id):
    return get_user_destinations(user_id)

@api_bp.route('/api/location/<user_id>')
def get_user_location(user_id):
    return _get_user_location(user_id)

@api_bp.route('/api/empresas', methods=['GET'])
def get_empresas():
    return _get_empresas()

@api_bp.route('/api/rutas', methods=['GET'])
def get_rutas():
    return _get_rutas()

@api_bp.route('/api/rutas', methods=['POST'])
def create_ruta():
    return _create_ruta()

@api_bp.route('/api/rutas/<int:ruta_id>', methods=['PUT'])
def update_ruta_endpoint(ruta_id):
    return _update_ruta(ruta_id)

@api_bp.route('/api/rutas/<int:ruta_id>', methods=['DELETE'])
def delete_ruta_endpoint(ruta_id):
    return _delete_ruta(ruta_id)

@api_bp.route('/api/debug/usuarios', methods=['GET'])
def debug_usuarios():
    return _debug_usuarios()

@api_bp.route('/api/segment/from-coords', methods=['GET'])
def segment_from_coords_id():
    return get_segment_from_coords()


# --- Segment Coords (para rutas guardadas) ---
@api_bp.route('/api/segment-coords/<segment_id>', methods=['GET'])
def get_segment_coords_endpoint(segment_id):
    return _get_segment_coords(segment_id)


@api_bp.route('/api/segment-coords/batch', methods=['POST'])
def get_multiple_segment_coords_endpoint():
    return _get_multiple_segment_coords()


@api_bp.route('/api/segment-coords', methods=['POST'])
def save_segment_coords_endpoint():
    return _save_segment_coords()


@api_bp.route('/api/rutas/<int:ruta_id>/waypoints', methods=['GET'])
def get_ruta_waypoints(ruta_id):
    return _get_ruta_waypoints(ruta_id)


@api_bp.route('/api/route/assign', methods=['POST'])
def assign_route_to_device():
    return _assign_route_to_device()

# --- Rutas de Test ---
@api_bp.route('/test/api/users/registered')
def test_registered_users():
    return get_registered_users()

@api_bp.route('/test/coordenadas')
def test_coordenadas():
    return _get_coordenadas()

@api_bp.route('/test/historico/<fecha>')
def test_get_historico(fecha):
    return _get_historico(fecha)

@api_bp.route('/test/historico/rango')
def test_get_historico_rango():
    return _get_historico_rango()

@api_bp.route('/test/historico/geocerca')
def test_get_historico_geocerca():
    return _get_historico_geocerca()

@api_bp.route('/test/osrm/route/<path:params>')
def test_osrm_proxy(params):
    return _osrm_proxy(params)

@api_bp.route('/test/tiles/<int:z>/<int:x>/<int:y>.png')
def test_tile_proxy(z, x, y):
    return _tile_proxy(z, x, y)

@api_bp.route('/test/api/devices/active')
def test_active_devices():
    return _get_active_devices()

@api_bp.route('/test/api/destination/send', methods=['POST'])
def test_send_destination():
    return _send_destination()

@api_bp.route('/test/database/destination/<user_id>')
def test_save_destinations(user_id):
    return get_user_destinations(user_id)

@api_bp.route('/test/api/location/<user_id>')
def test_get_user_location(user_id):
    return _get_user_location(user_id)

@api_bp.route('/test/api/congestion', methods=['GET'])
def test_congestion_consult():
    return get_congestion()

@api_bp.route('/test/api/empresas', methods=['GET'])
def test_get_empresas():
    return _get_empresas()

@api_bp.route('/test/api/rutas', methods=['GET'])
def test_get_rutas():
    return _get_rutas()

@api_bp.route('/test/api/rutas', methods=['POST'])
def test_create_ruta():
    return _create_ruta()

@api_bp.route('/test/api/rutas/<int:ruta_id>', methods=['PUT'])
def test_update_ruta_endpoint(ruta_id):
    return _update_ruta(ruta_id)

@api_bp.route('/test/api/rutas/<int:ruta_id>', methods=['DELETE'])
def test_delete_ruta_endpoint(ruta_id):
    return _delete_ruta(ruta_id)

@api_bp.route('/test/api/segment/from-coords', methods=['GET'])
def test_segment_from_coords_id():
    return get_segment_from_coords()

@api_bp.route('/test/api/buildings', methods=['GET'])
def test_get_buildings():
    return _get_buildings()

@api_bp.route('/test/api/buildings/search', methods=['GET'])
def test_search_buildings():
    return _search_buildings()


# --- Rutas de Utilidad ---
@api_bp.route('/version')
def version():
    return jsonify(get_git_info())

@api_bp.route('/health')
def health():
    db_status = 'unhealthy'
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()
        db_status = 'healthy'
    except:
        pass
    
    osrm_status = 'healthy' if check_osrm_available() else 'unavailable'

    tileserver_status = 'unavailable'
    try:
        from app.config import TILESERVER_HOST
        tile_resp = requests.get(f"{TILESERVER_HOST}/tile/0/0/0.png", timeout=3)
        if tile_resp.status_code == 200:
            tileserver_status = 'healthy'
    except:
        pass

    return jsonify({
        'status': 'healthy' if db_status == 'healthy' else 'degraded',
        'database': db_status,
        'osrm': osrm_status,
        'snap_to_roads': osrm_status == 'healthy',
        'tileserver': tileserver_status,
        'name': current_app.config['NAME'],
        'mode': 'test' if current_app.config['IS_TEST_MODE'] else 'production',
        **get_git_info()
    })

def _get_coordenadas_all():
    """Retorna las últimas coordenadas de todos los usuarios activos (últimos 30 segundos)"""
    try:
        conn = get_db()
        cursor = conn.cursor()
        
        # Configurar zona horaria
        cursor.execute("SET TIME ZONE 'America/Bogota'")
        
        # Obtener la última coordenada de cada usuario activo
        # Usa PostgreSQL syntax correctamente
        cursor.execute('''
            SELECT DISTINCT ON (user_id)
                id, lat, lon, timestamp, source, user_id
            FROM coordinates
            WHERE user_id IS NOT NULL
              AND TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') 
                  >= NOW() - INTERVAL '30 seconds'
            ORDER BY user_id, TO_TIMESTAMP(timestamp, 'DD/MM/YYYY HH24:MI:SS') DESC
        ''')

        rows = cursor.fetchall()
        conn.close()
        
        devices = []
        for row in rows:
            devices.append({
                'id': row[0],
                'lat': float(row[1]),
                'lon': float(row[2]),
                'timestamp': row[3],
                'source': row[4] or f'user_{row[5]}',
                'user_id': row[5],
                'device_id': f'user_{row[5]}'
            })
        
        log.info(f"📡 Coordenadas activas: {len(devices)} dispositivos")
        return jsonify(devices)
    except Exception as e:
        log.error(f"Error obteniendo coordenadas de todos los dispositivos: {e}")
        import traceback
        log.error(traceback.format_exc())
        return jsonify([]), 500

# --- Rutas de Producción ---
@api_bp.route('/coordenadas/all')
def coordenadas_all():
    return _get_coordenadas_all()

@api_bp.route('/api/users/register', methods=['POST'])
def register_user():
    return _register_user()

# --- Rutas de Test ---
@api_bp.route('/test/coordenadas/all')
def test_coordenadas_all():
    return _get_coordenadas_all()

@api_bp.route('/api/destination/complete', methods=['POST'])
def complete_destination():
    return _complete_destination()

# Test
@api_bp.route('/test/api/destination/complete', methods=['POST'])
def test_complete_destination():
    return _complete_destination()

@api_bp.route('/test/api/users/register', methods=['POST'])
def test_register_user():
    return _register_user()

@api_bp.route('/test/api/debug/usuarios', methods=['GET'])
def test_debug_usuarios():
    return _debug_usuarios()

@api_bp.route('/test/api/buildings/recalculate', methods=['POST'])
def recalculate_building_test():
    return recalculate_building_endpoint()


# --- Test: Segment Coords ---
@api_bp.route('/test/api/segment-coords/<segment_id>', methods=['GET'])
def test_get_segment_coords_endpoint(segment_id):
    return _get_segment_coords(segment_id)


@api_bp.route('/test/api/segment-coords/batch', methods=['POST'])
def test_get_multiple_segment_coords_endpoint():
    return _get_multiple_segment_coords()


@api_bp.route('/test/api/segment-coords', methods=['POST'])
def test_save_segment_coords_endpoint():
    return _save_segment_coords()


@api_bp.route('/test/api/rutas/<int:ruta_id>/waypoints', methods=['GET'])
def test_get_ruta_waypoints(ruta_id):
    return _get_ruta_waypoints(ruta_id)


@api_bp.route('/test/api/route/assign', methods=['POST'])
def test_assign_route_to_device():
    return _assign_route_to_device()

# Producción
@api_bp.route('/api/route/progress/<user_id>', methods=['GET'])
def get_route_progress(user_id):
    return _get_route_progress(user_id)

# Test
@api_bp.route('/test/api/route/progress/<user_id>', methods=['GET'])
def test_get_route_progress(user_id):
    return _get_route_progress(user_id)


# ===== REGISTERED BUILDINGS (Admin) =====

def _register_building():
    """Inserta o actualiza un edificio en registered_buildings."""
    try:
        data = request.json
        osm_id = data.get('osm_id')
        name = data.get('name', '').strip()

        if not osm_id or not name:
            return jsonify({'success': False, 'error': 'osm_id y name son requeridos'}), 400

        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('''
            INSERT INTO registered_buildings (osm_id, name)
            VALUES (%s, %s)
            ON CONFLICT (osm_id) DO UPDATE SET name = EXCLUDED.name
        ''', (int(osm_id), name))
        conn.commit()
        conn.close()

        return jsonify({'success': True, 'osm_id': int(osm_id), 'name': name})

    except Exception as e:
        log.error(f"Error registrando edificio: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


def _get_registered_buildings():
    """Retorna todos los edificios en registered_buildings."""
    try:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute('SELECT osm_id, name, created_at FROM registered_buildings ORDER BY created_at DESC')
        rows = cursor.fetchall()
        conn.close()

        buildings = [
            {'osm_id': r[0], 'name': r[1], 'created_at': r[2].strftime('%d/%m/%Y %H:%M:%S')}
            for r in rows
        ]
        return jsonify({'success': True, 'buildings': buildings, 'count': len(buildings)})

    except Exception as e:
        log.error(f"Error obteniendo registered_buildings: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@api_bp.route('/api/buildings/register', methods=['POST'])
def register_building():
    return _register_building()


@api_bp.route('/api/buildings/registered', methods=['GET'])
def get_registered_buildings_endpoint():
    return _get_registered_buildings()


def _get_port_polygon():
    try:
        import psycopg2
        from app.config import (
            TILESERVER_DB_HOST, TILESERVER_DB_PORT,
            TILESERVER_DB_NAME, TILESERVER_DB_USER, TILESERVER_DB_PASSWORD
        )
        conn = psycopg2.connect(
            host=TILESERVER_DB_HOST,
            port=int(TILESERVER_DB_PORT),
            dbname=TILESERVER_DB_NAME,
            user=TILESERVER_DB_USER,
            password=TILESERVER_DB_PASSWORD,
            connect_timeout=5
        )
        cur = conn.cursor()
        cur.execute("""
            SELECT ST_AsGeoJSON(ST_Transform(way, 4326))
            FROM planet_polygon
            WHERE landuse IS NOT NULL
            ORDER BY ST_Area(way) DESC
            LIMIT 1
        """)
        row = cur.fetchone()
        cur.close()
        conn.close()

        if not row:
            return jsonify({'success': False, 'error': 'No port polygon found'}), 404

        return jsonify({'success': True, 'geometry': json.loads(row[0])})

    except Exception as e:
        log.error(f"Error obteniendo polígono del puerto: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@api_bp.route('/api/port-polygon', methods=['GET'])
def get_port_polygon():
    return _get_port_polygon()


@api_bp.route('/test/api/port-polygon', methods=['GET'])
def test_get_port_polygon():
    return _get_port_polygon()