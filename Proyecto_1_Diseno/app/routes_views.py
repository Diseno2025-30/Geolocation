# app/routes_views.py
from flask import Blueprint, render_template, current_app
from app.utils import get_git_info
from app.database import get_latest_db_records

views_bp = Blueprint('views', __name__)

def _get_view_context():
    """Helper para obtener el contexto común de las vistas (git info, nombre, etc)."""
    git_info = get_git_info()
    test_warning = None
    if git_info['is_test']:
        test_warning = f"⚠ AMBIENTE DE PRUEBA - Rama: {git_info['branch']}"
    
    return {
        'name': current_app.config['NAME'],
        'git_info': git_info,
        'is_test': git_info['is_test'],
        'test_warning': test_warning
    }

# ===== RUTAS DE PRODUCCIÓN =====
@views_bp.route('/')
def home():
    """Ruta principal - muestra el frontend real-time"""
    context = _get_view_context()
    return render_template('frontend.html', **context)

@views_bp.route('/historics/')
def historics():
    """Ruta histórica - muestra el frontend histórico"""
    context = _get_view_context()
    return render_template('frontend_historical.html', **context)

@views_bp.route('/database')
def database():
    """Vista de la base de datos"""
    context = _get_view_context()
    coordinates = get_latest_db_records(20)
    return render_template('database.html', coordinates=coordinates, **context)

@views_bp.route('/control/')
def control():
    """Ruta torre de control - muestra la torre de control"""
    context = _get_view_context()
    return render_template('control.html', **context)

@views_bp.route('/rutas/')
def rutas():
    """Vista de gestión de rutas preestablecidas"""
    context = _get_view_context()
    return render_template('rutas.html', **context)

@views_bp.route('/mapa/')
def mapa():
    """Vista del mapa Leaflet independiente"""
    context = _get_view_context()
    return render_template('mapa.html', **context)

@views_bp.route('/versiones/')
def versiones():
    """Vista de gestión de versiones de mapas"""
    context = _get_view_context()
    return render_template('versiones.html', **context)

# ===== RUTAS DE MODO TEST =====
@views_bp.route('/test/')
def test_home():
    """Ruta de test - muestra el frontend real-time en modo test"""
    context = _get_view_context()
    # Forzar el banner de test para esta ruta
    context['test_warning'] = f"⚠ AMBIENTE DE PRUEBA - Rama: {context['git_info']['branch']}"
    context['is_test'] = True
    return render_template('frontend.html', **context)

@views_bp.route('/test/historics/')
def test_historics():
    """Ruta histórica de test - muestra el frontend histórico en modo test"""
    context = _get_view_context()
    context['test_warning'] = f"⚠ AMBIENTE DE PRUEBA - Rama: {context['git_info']['branch']}"
    context['is_test'] = True
    return render_template('frontend_historical.html', **context)

@views_bp.route('/test/control/')
def test_control():
    """Ruta torre de control de test - muestra la torre de control de test"""
    context = _get_view_context()
    context['test_warning'] = f"⚠ AMBIENTE DE PRUEBA - Rama: {context['git_info']['branch']}"
    context['is_test'] = True
    return render_template('control.html', **context)

@views_bp.route('/test/rutas/')
def test_rutas():
    """Vista de gestión de rutas en modo test"""
    context = _get_view_context()
    context['test_warning'] = f"⚠ AMBIENTE DE PRUEBA - Rama: {context['git_info']['branch']}"
    context['is_test'] = True
    return render_template('rutas.html', **context)