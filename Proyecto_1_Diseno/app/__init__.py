# app/__init__.py
from flask import Flask, request
from . import database, config

def create_app():
    """Fábrica de la aplicación Flask."""
    
    app = Flask(__name__,
                static_folder='static',
                template_folder='templates')
    
    # Cargar configuración desde config.py
    app.config.from_object('app.config')

    # Inicializar la base de datos (crear tabla si no existe)
    with app.app_context():
        database.create_table()

    # Registrar procesadores de contexto
    @app.context_processor
    def utility_processor():
        def get_static_path(filename):
            """Genera la ruta correcta para archivos estáticos según el modo."""
            if app.config['IS_TEST_MODE'] or request.path.startswith('/test/'):
                return f'/test/app/static/{filename}'
            return f'/app/static/{filename}'
        
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

    return app