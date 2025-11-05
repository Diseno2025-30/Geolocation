# app/routes_api.py
from flask import Blueprint, jsonify, request, current_app
from app.database import (
    get_last_coordinate, get_historical_by_date, 
    get_historical_by_range, get_historical_by_geofence, get_db
)
from app.utils import get_git_info
from app.services_osrm import check_osrm_available
from datetime import datetime
import requests

api_bp = Blueprint('api', __name__)

# ===== ENDPOINTS DE API (Producción y Test) =====

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
        
        user_id = request.args.get('user_id')  # Ya es string

        if not fecha_inicio_str or not fecha_fin_str:
            return jsonify({'error': 'Se requieren los parámetros inicio y fin'}), 400

        start_datetime = datetime.strptime(f"{fecha_inicio_str} {hora_inicio_str}", '%Y-%m-%d %H:%M')
        end_datetime = datetime.strptime(f"{fecha_fin_str} {hora_fin_str}", '%Y-%m-%d %H:%M').replace(second=59) 

        if start_datetime > end_datetime:
            return jsonify({'error': 'La fecha/hora de inicio debe ser anterior a la fecha/hora de fin'}), 400

        coordenadas = get_historical_by_range(start_datetime, end_datetime, user_id=user_id)
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
        
        user_id = request.args.get('user_id')  # Ya es string
        
        coordenadas = get_historical_by_geofence(min_lat, max_lat, min_lon, max_lon, user_id=user_id)
        return jsonify(coordenadas)
    except Exception as e:
        print(f"Error en consulta por geocerca: {e}")
        return jsonify({'error': 'Error interno del servidor o parámetros inválidos'}), 500

def _osrm_proxy(params):
    try:
        url = f"http://localhost:5001/route/v1/driving/{params}"
        response = requests.get(url, params=request.args, timeout=5)
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({'error': str(e), 'code': 'Error'}), 500

# --- Rutas de Producción ---
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

# --- Rutas de Test ---
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
    
    return jsonify({
        'status': 'healthy' if db_status == 'healthy' else 'degraded',
        'database': db_status,
        'osrm': osrm_status,
        'snap_to_roads': osrm_status == 'healthy',
        'name': current_app.config['NAME'],
        'mode': 'test' if current_app.config['IS_TEST_MODE'] else 'production',
        **get_git_info()
    })