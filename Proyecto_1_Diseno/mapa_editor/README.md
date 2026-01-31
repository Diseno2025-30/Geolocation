# 🗺️ Editor de Mapas OSRM

Sistema completo e independiente para editar mapas, exportarlos a formato OSM y actualizar OSRM Docker.

## 📁 Estructura del Proyecto

```
mapa_editor/
├── database/
│   ├── mapa_editor.db          # Base de datos SQLite (se crea automáticamente)
│   ├── schema.sql              # Esquema de la base de datos
│   └── exports/                # Directorio de exportaciones OSM (auto-generado)
│
├── models/
│   └── map_models.py           # Modelos de datos (Node, Way, Tag)
│
├── services/
│   ├── osm_service.py          # Exportación a formato OSM XML
│   └── osrm_integration.py     # Integración con OSRM Docker
│
├── api/
│   └── mapa_routes.py          # API REST endpoints
│
└── README.md                   # Este archivo

static/
├── js/mapa_editor/
│   └── mapa_editor.js          # Editor interactivo JavaScript
└── css/mapa_editor/
    └── mapa_editor.css         # Estilos del editor

templates/
└── mapa.html                   # Interfaz del editor
```

---

## 🚀 Inicio Rápido

### 1. Acceder al Editor

Una vez que el servidor Flask esté corriendo:

```
http://localhost:[puerto]/mapa/
```

O desde el menú lateral: **Mapa**

### 2. Dibujar una Calle

1. Haz clic en **"✏️ Dibujar Calle"**
2. Haz clic en el mapa para agregar puntos (nodos)
3. Presiona **Enter** para finalizar
4. Ingresa el nombre y tipo de calle
5. La calle se guarda automáticamente en la base de datos

### 3. Exportar a OSRM

1. Dibuja o modifica calles
2. Haz clic en **"📤 Exportar OSM"** para generar el archivo .osm
3. Haz clic en **"🐳 Actualizar OSRM"** para procesar el mapa en Docker

---

## 📊 Base de Datos

### Tablas Principales

#### `nodes` - Puntos en el mapa
```sql
id          - ID único
osm_id      - ID compatible con OSM (opcional)
lat         - Latitud (-90 a 90)
lon         - Longitud (-180 a 180)
created_at  - Fecha de creación
updated_at  - Fecha de actualización
```

#### `ways` - Calles
```sql
id            - ID único
osm_id        - ID compatible con OSM (opcional)
name          - Nombre de la calle
highway_type  - Tipo de vía (road, residential, primary, etc.)
oneway        - Dirección única (0 o 1)
maxspeed      - Velocidad máxima (km/h)
created_at    - Fecha de creación
updated_at    - Fecha de actualización
```

#### `way_nodes` - Relación entre calles y nodos
```sql
way_id    - ID de la calle
node_id   - ID del nodo
sequence  - Orden del nodo en la calle (1, 2, 3...)
```

#### `tags` - Metadatos adicionales
```sql
entity_type  - 'node' o 'way'
entity_id    - ID del nodo o calle
key          - Clave (ej: 'lanes', 'bridge')
value        - Valor (ej: '2', 'yes')
```

### Inicialización

La base de datos se inicializa automáticamente al arrancar la aplicación. El esquema se encuentra en:

```
mapa_editor/database/schema.sql
```

---

## 🔌 API REST

Base URL: `/api/mapa`

### Nodos

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET    | `/nodes` | Obtener todos los nodos |
| GET    | `/nodes/<id>` | Obtener un nodo específico |
| POST   | `/nodes` | Crear nuevo nodo |
| PUT    | `/nodes/<id>` | Actualizar nodo |
| DELETE | `/nodes/<id>` | Eliminar nodo |

#### Crear Nodo (POST `/nodes`)
```json
{
  "lat": 11.0041,
  "lon": -74.8070,
  "osm_id": 12345  // opcional
}
```

### Calles (Ways)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET    | `/ways` | Obtener todas las calles |
| GET    | `/ways/<id>` | Obtener una calle específica |
| POST   | `/ways` | Crear nueva calle |
| PUT    | `/ways/<id>` | Actualizar calle |
| DELETE | `/ways/<id>` | Eliminar calle |

#### Crear Calle (POST `/ways`)
```json
{
  "node_ids": [1, 2, 3],              // IDs de nodos (en orden)
  "name": "Calle Principal",          // opcional
  "highway_type": "primary",          // opcional (default: road)
  "oneway": false,                    // opcional
  "maxspeed": 60                      // opcional
}
```

### Exportación

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET    | `/export/geojson` | Exportar a GeoJSON |
| POST   | `/export/osm` | Exportar a formato OSM XML |
| POST   | `/export/osrm` | Exportar y actualizar OSRM Docker |

#### Actualizar OSRM (POST `/export/osrm`)
```json
{
  "container_name": "osrm",      // Nombre del contenedor Docker
  "restart_service": false       // Si reiniciar el servicio
}
```

### Estadísticas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET    | `/stats` | Estadísticas generales |
| GET    | `/export/history` | Historial de exportaciones |

---

## 🐍 Modelos de Python

### `MapDatabase` - Gestión de la base de datos

```python
from mapa_editor.models.map_models import MapDatabase

db = MapDatabase()
stats = db.get_stats()
print(stats)  # {'total_nodes': 50, 'total_ways': 10, ...}
db.close()
```

### `Node` - Operaciones con nodos

```python
from mapa_editor.models.map_models import MapDatabase, Node

db = MapDatabase()
node_model = Node(db)

# Crear nodo
node_id = node_model.create(lat=11.0041, lon=-74.8070)

# Obtener nodo
node = node_model.get(node_id)

# Buscar nodos cercanos
nearby = node_model.find_nearby(lat=11.0041, lon=-74.8070, radius=0.001)

# Actualizar nodo
node_model.update(node_id, lat=11.0050)

# Eliminar nodo
node_model.delete(node_id)
```

### `Way` - Operaciones con calles

```python
from mapa_editor.models.map_models import MapDatabase, Way

db = MapDatabase()
way_model = Way(db)

# Crear calle
way_id = way_model.create(
    node_ids=[1, 2, 3],
    name="Calle Principal",
    highway_type="primary",
    oneway=False,
    maxspeed=60
)

# Obtener calle con sus nodos
way = way_model.get(way_id)
print(way['nodes'])  # Lista de nodos ordenados

# Actualizar calle
way_model.update(way_id, name="Nueva Calle", maxspeed=80)

# Actualizar nodos de la calle
way_model.update_nodes(way_id, [1, 2, 3, 4, 5])

# Eliminar calle
way_model.delete(way_id)
```

### `Tag` - Metadatos adicionales

```python
from mapa_editor.models.map_models import MapDatabase, Tag

db = MapDatabase()
tag_model = Tag(db)

# Agregar tag
tag_model.set('way', way_id, 'lanes', '2')
tag_model.set('way', way_id, 'bridge', 'yes')

# Obtener todos los tags de una entidad
tags = tag_model.get('way', way_id)
print(tags)  # {'lanes': '2', 'bridge': 'yes'}

# Eliminar tag específico
tag_model.delete('way', way_id, 'bridge')

# Eliminar todos los tags
tag_model.delete('way', way_id)
```

---

## 📤 Exportación a OSM

### Desde Python

```python
from mapa_editor.services.osm_service import export_database_to_osm

# Exportar base de datos a archivo .osm
osm_file = export_database_to_osm()
print(f"Archivo generado: {osm_file}")
```

### Validación

El exportador valida automáticamente:
- Cada calle tiene al menos 2 nodos
- Tipos de highway son estándar
- No hay nodos huérfanos (opcional)

---

## 🐳 Integración con OSRM Docker

### Requisitos

- Docker instalado y corriendo
- Contenedor OSRM disponible (nombre por defecto: `osrm`)

### Desde Python

```python
from mapa_editor.services.osrm_integration import full_update_workflow

# Flujo completo: exportar → copiar → procesar
results = full_update_workflow(
    container_name='osrm',
    restart_service=False
)

if results['success']:
    print("✓ OSRM actualizado exitosamente")
else:
    print("❌ Error:", results['errors'])
```

### Desde Línea de Comandos

```bash
# Actualizar OSRM
python mapa_editor/services/osrm_integration.py --container osrm

# Actualizar y reiniciar servicio
python mapa_editor/services/osrm_integration.py --container osrm --restart
```

### Proceso Interno

1. **Exportar BD a OSM**: Convierte la base de datos a formato .osm
2. **Copiar al contenedor**: `docker cp archivo.osm osrm:/data/`
3. **osrm-extract**: Procesa la geometría del mapa
4. **osrm-contract**: Pre-calcula rutas optimizadas
5. **Reiniciar** (opcional): `docker restart osrm`

---

## ⌨️ Atajos de Teclado

| Tecla | Acción |
|-------|--------|
| **Esc** | Cancelar operación actual |
| **Enter** | Finalizar dibujo de calle |
| **Backspace/Delete** | Eliminar último punto al dibujar |

---

## 🎨 Tipos de Vías (highway_type)

Tipos estándar de OpenStreetMap:

| Tipo | Descripción |
|------|-------------|
| `motorway` | Autopista |
| `trunk` | Vía troncal |
| `primary` | Vía primaria |
| `secondary` | Vía secundaria |
| `tertiary` | Vía terciaria |
| `residential` | Calle residencial |
| `service` | Vía de servicio |
| `road` | Camino genérico (default) |
| `unclassified` | Sin clasificar |
| `living_street` | Calle peatonal compartida |
| `pedestrian` | Solo peatones |
| `track` | Camino rural |
| `path` | Sendero |

---

## 🔧 Personalización

### Colores del Editor

Editar en `static/js/mapa_editor/mapa_editor.js`:

```javascript
const editor = new MapaEditor('map', {
    drawColor: '#FF4444',      // Color al dibujar
    wayColor: '#3388ff',       // Color de calles
    selectedColor: '#FFaa00'   // Color de selección
});
```

### Configuración de OSRM

Editar en `mapa_editor/services/osrm_integration.py`:

```python
osrm = OSRMIntegration(
    container_name='mi_osrm',    # Nombre del contenedor
    osrm_data_dir='/data'        # Directorio de datos en contenedor
)
```

---

## 🐛 Solución de Problemas

### Error: "Docker no está corriendo"
```bash
# Verificar Docker
docker info

# Iniciar Docker Desktop (Windows/Mac)
# O iniciar servicio (Linux)
sudo systemctl start docker
```

### Error: "Contenedor no existe"
```bash
# Ver contenedores disponibles
docker ps -a

# Verificar nombre del contenedor OSRM
docker ps --filter "name=osrm"
```

### Error: "No se puede conectar a la API"
- Verificar que el servidor Flask esté corriendo
- Verificar que la ruta base (`window.BASE_PATH`) sea correcta
- Revisar la consola del navegador para errores

### Base de datos no se inicializa
- Verificar que `mapa_editor/database/schema.sql` existe
- Verificar permisos de escritura en el directorio
- Revisar logs de la aplicación Flask

---

## 📚 Referencias

- [OpenStreetMap Wiki - Map Features](https://wiki.openstreetmap.org/wiki/Map_Features)
- [OSRM Documentation](http://project-osrm.org/)
- [Leaflet.js Documentation](https://leafletjs.com/)
- [GeoJSON Specification](https://geojson.org/)

---

## 🎯 Próximas Funcionalidades

- [ ] Editar calles existentes (mover nodos)
- [ ] Importar archivos OSM existentes
- [ ] Soporte para relaciones (relations)
- [ ] Validación avanzada de topología
- [ ] Historial de cambios (undo/redo)
- [ ] Colaboración multi-usuario
- [ ] Exportación a otros formatos (Shapefile, KML)

---

## 📄 Licencia

Este proyecto es parte del sistema de rastreo GPS y es de uso interno.

---

## 👨‍💻 Autor

Desarrollado como módulo independiente para el proyecto de Diseño 2025-30.
