#!/usr/bin/env sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "Usage: ./prepare.sh /absolute/path/to/region.osm.pbf" >&2
  exit 2
fi

source_pbf=$1
case "$source_pbf" in
  /*) ;;
  *) echo "Use an absolute .osm.pbf path" >&2; exit 2 ;;
esac
if [ ! -f "$source_pbf" ]; then
  echo "PBF not found: $source_pbf" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "$script_dir/data"
cp "$source_pbf" "$script_dir/data/region.osm.pbf"

docker run --rm -t -v "$script_dir/data:/data" osrm/osrm-backend:v5.27.1 \
  osrm-extract -p /opt/car.lua /data/region.osm.pbf
docker run --rm -t -v "$script_dir/data:/data" osrm/osrm-backend:v5.27.1 \
  osrm-partition /data/region.osrm
docker run --rm -t -v "$script_dir/data:/data" osrm/osrm-backend:v5.27.1 \
  osrm-customize /data/region.osrm

echo "Prepared $script_dir/data/region.osrm. Start with: docker compose -f $script_dir/docker-compose.yml up -d"

