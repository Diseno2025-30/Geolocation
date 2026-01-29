import threading
import argparse
from app import create_app
from app.services_udp import udp_listener, set_flask_app
from app.config import IS_TEST_MODE, BRANCH_NAME, NAME

# Crear la instancia de la aplicación Flask
app = create_app()

# Configurar la app en el listener UDP
set_flask_app(app)

if __name__ == "__main__":
    # Configurar argumentos de línea de comandos
    parser = argparse.ArgumentParser(description='Flask UDP Server')
    parser.add_argument('--port', type=int, default=5000, help='Port to run the web server on')
    args = parser.parse_args()

    # Iniciar el listener UDP para COORDENADAS en un thread separado (puerto 5049)
    udp_thread = threading.Thread(target=udp_listener, daemon=True)
    udp_thread.start()
    
    # Determinar el modo de ejecución
    mode = 'TEST' if IS_TEST_MODE else 'PRODUCTION'
    print(f"Starting Flask app on port {args.port} - Mode: {mode}")
    
    if IS_TEST_MODE:
        print(f"Branch: {BRANCH_NAME}")
        print(f"Server Name: {NAME}")
    
    # Mostrar servicios activos
    print("🎧 Services:")
    print("   📍 GPS Coordinates: UDP port 5049")
    print("   👤 User Registration: HTTPS /api/users/register")
    print("   🌐 Web Dashboard: HTTPS port", args.port)
    
    # Iniciar la aplicación Flask
    app.run(host='0.0.0.0', port=args.port, debug=IS_TEST_MODE)
