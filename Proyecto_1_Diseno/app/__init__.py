# app/__init__.py
from flask import Flask, request
from . import database, config
from pathlib import Path
from flask_jwt_extended import JWTManager
import firebase_admin
from firebase_admin import credentials
import os

BASE_DIR = Path(__file__).resolve().parent.parent

try:
    sdk_path = str(BASE_DIR / 'firebase-admin-sdk.json')
    if not os.path.exists(sdk_path):
        raise FileNotFoundError
    cred = credentials.Certificate(sdk_path)
    firebase_admin.initialize_app(cred)
    print("✅ Firebase Admin SDK inicializado desde archivo.")
except FileNotFoundError:
    print(f"❌ ERROR: No se encontró 'firebase-admin-sdk.json' en {sdk_path}")
    print("   Asegúrate de que el script de deploy lo haya creado correctamente desde el Secret 'FIREBASE_SDK_JSON'.")
except Exception as e:
    print(f"❌ Error al inicializar Firebase Admin SDK: {e}")

def create_app():
    """Fábrica de la aplicación Flask."""
    
    app = Flask(
        __name__,
        template_folder=str(BASE_DIR / "templates"),
        static_folder=str(BASE_DIR / "static")
    )
    
    # Cargar configuración desde config.py
    app.config.from_object('app.config')
    
    app.config["JWT_SECRET_KEY"] = config.JWT_SECRET_KEY
    jwt = JWTManager(app)

    with app.app_context():
        database.create_table()
        database.create_users_table()

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
    from . import routes_auth
    
    app.register_blueprint(routes_views.views_bp)
    app.register_blueprint(routes_api.api_bp)
    app.register_blueprint(routes_auth.auth_bp)

    return app