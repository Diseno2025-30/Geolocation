# app/services_osrm.py
import requests
from app.config import OSRM_HOST

def snap_to_road(lat, lon):
    """Ajusta las coordenadas GPS a la calle más cercana usando OSRM local."""
    try:
        url = f"{OSRM_HOST}/nearest/v1/driving/{lon},{lat}"
        response = requests.get(url, params={'number': 1}, timeout=2)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('code') == 'Ok' and len(data.get('waypoints', [])) > 0:
                snapped_location = data['waypoints'][0]['location']
                snapped_lon = snapped_location[0]
                snapped_lat = snapped_location[1]
                distance = data['waypoints'][0].get('distance', 0)
                
                print(f"✓ Snap-to-road: ({lat:.6f}, {lon:.6f}) → ({snapped_lat:.6f}, {snapped_lon:.6f}) | Ajuste: {distance:.2f}m")
                return snapped_lat, snapped_lon
            else:
                print(f"⚠ OSRM: No encontró calle cercana para ({lat:.6f}, {lon:.6f}), usando coordenadas originales")
                return lat, lon
        else:
            print(f"⚠ OSRM HTTP error {response.status_code}, usando coordenadas originales")
            return lat, lon
            
    except requests.exceptions.RequestException as e:
        print(f"⚠ Error de conexión OSRM: {e}, usando coordenadas originales")
        return lat, lon
    except Exception as e:
        print(f"⚠ Error en snap_to_road: {e}, usando coordenadas originales")
        return lat, lon

def check_osrm_available():
    """Verifica si OSRM está disponible."""
    try:
        response = requests.get(f"{OSRM_HOST}/nearest/v1/driving/-74.8,11.0", timeout=2)
        if response.status_code == 200:
            print("✅ OSRM disponible")
            return True
        else:
            print("⚠️ OSRM responde pero con error")
            return False
    except requests.exceptions.RequestException:
        print("⚠️ OSRM no disponible - snap-to-roads desactivado")
        return False