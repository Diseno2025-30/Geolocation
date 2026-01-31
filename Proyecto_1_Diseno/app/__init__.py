# app/__init__.py
from flask import Flask, request
from . import database, config
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def create_app():
    """Fábrica de la aplicación Flask."""
    
    app = Flask(
        __name__,
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static")
    )
    
    # Cargar configuración desde config.py
    app.config.from_object('app.config')

    with app.app_context():
        # Crear tablas si no existen
        database.create_table()
        database.create_destinations_table()
        database.create_usuarios_web_table()  # ← CAMBIO AQUÍ
        database.create_rutas_table()
        database.migrate_add_segment_fields()
        database.migrate_add_completed_at()

    @app.context_processor
    def utility_processor():
        def get_static_path(filename):
            """Genera la ruta correcta para archivos estáticos según el modo."""
            if app.config['IS_TEST_MODE'] or request.path.startswith('/test/'):
                return f'/test/static/{filename}'
            return f'/static/{filename}'
        
        def get_base_path():
            """Retorna el base path según si estamos en test o no."""
            if app.config['IS_TEST_MODE'] or request.path.startswith('/test/'):
                return '/test'
            return ''
        
        return dict(
            get_static_path=get_static_path,
            get_base_path=get_base_path
        )

    # Registrar Blueprints (grupos de rutas)
    from . import routes_views
    from . import routes_api

    app.register_blueprint(routes_views.views_bp)
    app.register_blueprint(routes_api.api_bp)

    # Registrar Blueprint de Mapa Editor (independiente)
    import sys
    sys.path.append(str(BASE_DIR / 'mapa_editor'))
    from mapa_editor.api.mapa_routes import mapa_api_bp
    app.register_blueprint(mapa_api_bp)

    return app