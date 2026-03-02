# Crear directorio de trabajo
sudo mkdir -p /opt/tilemaker
sudo chown ubuntu:ubuntu /opt/tilemaker
cd /opt/tilemaker

# Copiar el PBF
cp /home/ubuntu/Web-server-UDP/test/.github/osm/Geolocation.osm.pbf .
ls -lh Geolocation.osm.pbf

# Bajar la imagen de tilemaker
docker pull ghcr.io/systemed/tilemaker:master