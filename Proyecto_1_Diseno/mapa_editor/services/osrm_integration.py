"""
============================================================================
SERVICIO DE INTEGRACIÓN OSRM
============================================================================

Este módulo maneja la integración con OSRM Docker para procesar
los mapas editados y actualizar el servicio de enrutamiento.

Flujo de trabajo:
1. Exportar datos de BD a archivo .osm
2. Copiar archivo al contenedor Docker
3. Ejecutar osrm-extract (procesar geometría)
4. Ejecutar osrm-contract (pre-calcular rutas)
5. Reiniciar servicio OSRM (opcional)

Requiere:
- Docker instalado y corriendo
- Contenedor OSRM disponible

============================================================================
"""

import subprocess
import os
import sys
from typing import Dict, Optional, Tuple
from datetime import datetime

# Importar servicio OSM
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from services.osm_service import export_database_to_osm
from models.map_models import MapDatabase


class OSRMIntegration:
    """Integración con OSRM Docker"""

    def __init__(
        self,
        container_name: str = 'osrm',
        osrm_data_dir: str = '/data'
    ):
        """
        Inicializa la integración con OSRM.

        Args:
            container_name: Nombre del contenedor Docker de OSRM
            osrm_data_dir: Directorio de datos dentro del contenedor
        """
        self.container_name = container_name
        self.osrm_data_dir = osrm_data_dir

    def check_docker_running(self) -> bool:
        """
        Verifica si Docker está corriendo.

        Returns:
            True si Docker está disponible
        """
        try:
            result = subprocess.run(
                ['docker', 'info'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception as e:
            print(f"❌ Error verificando Docker: {e}")
            return False

    def check_container_exists(self) -> bool:
        """
        Verifica si el contenedor OSRM existe.

        Returns:
            True si el contenedor existe
        """
        try:
            result = subprocess.run(
                ['docker', 'ps', '-a', '--filter', f'name={self.container_name}', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=5
            )

            containers = result.stdout.strip().split('\n')
            return self.container_name in containers

        except Exception as e:
            print(f"❌ Error verificando contenedor: {e}")
            return False

    def is_container_running(self) -> bool:
        """
        Verifica si el contenedor OSRM está corriendo.

        Returns:
            True si el contenedor está corriendo
        """
        try:
            result = subprocess.run(
                ['docker', 'ps', '--filter', f'name={self.container_name}', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=5
            )

            containers = result.stdout.strip().split('\n')
            return self.container_name in containers

        except Exception as e:
            print(f"❌ Error verificando estado del contenedor: {e}")
            return False

    def copy_file_to_container(
        self,
        local_path: str,
        container_path: str
    ) -> Tuple[bool, str]:
        """
        Copia un archivo al contenedor Docker.

        Args:
            local_path: Ruta local del archivo
            container_path: Ruta destino en el contenedor

        Returns:
            (éxito, mensaje)
        """
        try:
            dest = f"{self.container_name}:{container_path}"
            result = subprocess.run(
                ['docker', 'cp', local_path, dest],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                return True, f"✓ Archivo copiado a {container_path}"
            else:
                return False, f"❌ Error copiando archivo: {result.stderr}"

        except Exception as e:
            return False, f"❌ Excepción copiando archivo: {e}"

    def run_osrm_extract(self, osm_file: str) -> Tuple[bool, str]:
        """
        Ejecuta osrm-extract para procesar el archivo OSM.

        Args:
            osm_file: Nombre del archivo .osm (dentro del contenedor)

        Returns:
            (éxito, salida del comando)
        """
        try:
            # osrm-extract procesa el archivo OSM y genera .osrm
            cmd = [
                'docker', 'exec', self.container_name,
                'osrm-extract',
                '-p', '/opt/car.lua',  # Perfil de coche
                f'{self.osrm_data_dir}/{osm_file}'
            ]

            print(f"Ejecutando: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minutos timeout
            )

            if result.returncode == 0:
                return True, f"✓ osrm-extract completado\n{result.stdout}"
            else:
                return False, f"❌ osrm-extract falló:\n{result.stderr}"

        except subprocess.TimeoutExpired:
            return False, "❌ osrm-extract timeout (>5 minutos)"
        except Exception as e:
            return False, f"❌ Excepción en osrm-extract: {e}"

    def run_osrm_contract(self, osrm_base: str) -> Tuple[bool, str]:
        """
        Ejecuta osrm-contract para pre-calcular rutas.

        Args:
            osrm_base: Nombre base del archivo .osrm (sin extensión)

        Returns:
            (éxito, salida del comando)
        """
        try:
            # osrm-contract optimiza los datos para enrutamiento rápido
            cmd = [
                'docker', 'exec', self.container_name,
                'osrm-contract',
                f'{self.osrm_data_dir}/{osrm_base}.osrm'
            ]

            print(f"Ejecutando: {' '.join(cmd)}")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300  # 5 minutos timeout
            )

            if result.returncode == 0:
                return True, f"✓ osrm-contract completado\n{result.stdout}"
            else:
                return False, f"❌ osrm-contract falló:\n{result.stderr}"

        except subprocess.TimeoutExpired:
            return False, "❌ osrm-contract timeout (>5 minutos)"
        except Exception as e:
            return False, f"❌ Excepción en osrm-contract: {e}"

    def process_map_update(
        self,
        osm_file_path: str,
        restart_service: bool = False
    ) -> Dict:
        """
        Proceso completo: exportar, copiar, procesar.

        Args:
            osm_file_path: Ruta local del archivo .osm
            restart_service: Si reiniciar el servicio OSRM después

        Returns:
            Diccionario con resultados de cada paso
        """
        results = {
            'success': False,
            'steps': [],
            'errors': []
        }

        # Paso 1: Verificar Docker
        print("\n" + "=" * 60)
        print("PASO 1: Verificando Docker")
        print("=" * 60)

        if not self.check_docker_running():
            results['errors'].append("Docker no está corriendo")
            return results

        results['steps'].append({'step': 'docker_check', 'status': 'success'})
        print("✓ Docker está corriendo")

        # Paso 2: Verificar contenedor OSRM
        print("\n" + "=" * 60)
        print("PASO 2: Verificando contenedor OSRM")
        print("=" * 60)

        if not self.check_container_exists():
            results['errors'].append(f"Contenedor '{self.container_name}' no existe")
            return results

        if not self.is_container_running():
            results['errors'].append(f"Contenedor '{self.container_name}' no está corriendo")
            print(f"ℹ️  Intenta iniciarlo con: docker start {self.container_name}")
            return results

        results['steps'].append({'step': 'container_check', 'status': 'success'})
        print(f"✓ Contenedor '{self.container_name}' está corriendo")

        # Paso 3: Copiar archivo al contenedor
        print("\n" + "=" * 60)
        print("PASO 3: Copiando archivo al contenedor")
        print("=" * 60)

        osm_filename = os.path.basename(osm_file_path)
        container_osm_path = f"{self.osrm_data_dir}/{osm_filename}"

        success, message = self.copy_file_to_container(osm_file_path, container_osm_path)
        print(message)

        if not success:
            results['errors'].append(message)
            return results

        results['steps'].append({'step': 'copy_file', 'status': 'success'})

        # Paso 4: Ejecutar osrm-extract
        print("\n" + "=" * 60)
        print("PASO 4: Ejecutando osrm-extract")
        print("=" * 60)

        success, output = self.run_osrm_extract(osm_filename)
        print(output)

        if not success:
            results['errors'].append(output)
            return results

        results['steps'].append({'step': 'osrm_extract', 'status': 'success'})

        # Paso 5: Ejecutar osrm-contract
        print("\n" + "=" * 60)
        print("PASO 5: Ejecutando osrm-contract")
        print("=" * 60)

        osrm_base = osm_filename.replace('.osm', '')
        success, output = self.run_osrm_contract(osrm_base)
        print(output)

        if not success:
            results['errors'].append(output)
            return results

        results['steps'].append({'step': 'osrm_contract', 'status': 'success'})

        # Paso 6 (opcional): Reiniciar servicio
        if restart_service:
            print("\n" + "=" * 60)
            print("PASO 6: Reiniciando servicio OSRM")
            print("=" * 60)

            try:
                subprocess.run(
                    ['docker', 'restart', self.container_name],
                    capture_output=True,
                    timeout=30
                )
                print(f"✓ Contenedor '{self.container_name}' reiniciado")
                results['steps'].append({'step': 'restart_service', 'status': 'success'})
            except Exception as e:
                print(f"⚠️  No se pudo reiniciar: {e}")
                results['steps'].append({'step': 'restart_service', 'status': 'warning'})

        # Éxito total
        results['success'] = True

        print("\n" + "=" * 60)
        print("✓ PROCESO COMPLETADO EXITOSAMENTE")
        print("=" * 60)
        print(f"Archivo procesado: {osrm_filename}")
        print(f"Ruta en contenedor: {container_osm_path}")

        return results


def full_update_workflow(
    db_path: str = None,
    container_name: str = 'osrm',
    restart_service: bool = False
) -> Dict:
    """
    Flujo completo: exportar BD → copiar → procesar OSRM.

    Args:
        db_path: Ruta de la base de datos (None = por defecto)
        container_name: Nombre del contenedor Docker
        restart_service: Si reiniciar el servicio al final

    Returns:
        Diccionario con resultados del proceso completo
    """
    print("\n" + "=" * 80)
    print("ACTUALIZACIÓN COMPLETA DE MAPA OSRM")
    print("=" * 80)

    # Paso A: Exportar base de datos a OSM
    print("\nFASE A: Exportando base de datos a formato OSM")
    print("-" * 80)

    osm_file = export_database_to_osm(db_path)

    if not osm_file:
        return {
            'success': False,
            'error': 'Fallo en la exportación de la base de datos'
        }

    # Paso B: Procesar con OSRM
    print("\nFASE B: Procesando con OSRM Docker")
    print("-" * 80)

    osrm = OSRMIntegration(container_name=container_name)
    results = osrm.process_map_update(osm_file, restart_service=restart_service)

    return results


if __name__ == '__main__':
    """
    Script de prueba: ejecuta el flujo completo desde línea de comandos.

    Uso:
        python osrm_integration.py [container_name] [--restart]
    """
    import argparse

    parser = argparse.ArgumentParser(
        description='Actualiza el mapa OSRM desde la base de datos del editor'
    )
    parser.add_argument(
        '--container',
        default='osrm',
        help='Nombre del contenedor Docker de OSRM (default: osrm)'
    )
    parser.add_argument(
        '--restart',
        action='store_true',
        help='Reiniciar el servicio OSRM después del proceso'
    )

    args = parser.parse_args()

    results = full_update_workflow(
        container_name=args.container,
        restart_service=args.restart
    )

    if results['success']:
        print("\n" + "🎉 " * 20)
        print("ACTUALIZACIÓN COMPLETADA EXITOSAMENTE")
        print("🎉 " * 20 + "\n")
    else:
        print("\n" + "❌ " * 20)
        print("ACTUALIZACIÓN FALLIDA")
        print("❌ " * 20)
        print(f"\nErrores: {results.get('errors', [])}\n")
