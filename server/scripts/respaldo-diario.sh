#!/usr/bin/env bash
# Respaldo diario del servidor (cron del usuario del VPS a las 03:00):
#   1. la base: admin backup --motivo diario (y semanal los domingos), que copia, verifica y rota (7 diarias, 4 semanales);
#   2. los adjuntos: rsync --link-dest a backups/adjuntos/AAAA-MM-DD (los archivos no cambian: cada día suma solo lo nuevo);
#   3. borra las carpetas de adjuntos de días que ya no tienen ningún respaldo de la base.
# Ejemplo de crontab:  0 3 * * * /srv/cuaderno/respaldo-diario.sh >> /srv/cuaderno/backups/respaldo.log 2>&1
set -euo pipefail

RAIZ="${CUADERNO_RAIZ:-/srv/cuaderno}"
# el comando de administración; para probar el script a mano se puede reemplazar por uno local
read -r -a ADMIN <<< "${CUADERNO_ADMIN:-docker exec cuaderno-server node dist/admin.js}"
BASE="$RAIZ/backups/base"
ADJUNTOS="$RAIZ/backups/adjuntos"
HOY="$(date -u +%F)"

echo "== respaldo $(date -u +%FT%TZ)"
# si falla la base se sigue con los adjuntos, y el script termina con error al final
fallo=0
"${ADMIN[@]}" backup --motivo diario || fallo=1
if [ "$(date -u +%u)" = "7" ]; then
  "${ADMIN[@]}" backup --motivo semanal || fallo=1
fi

command -v rsync >/dev/null || { echo "== ERROR: falta rsync en el VPS: los adjuntos no se respaldaron" >&2; exit 1; }
mkdir -p "$ADJUNTOS"
ULTIMO="$(find "$ADJUNTOS" -mindepth 1 -maxdepth 1 -type d -name '????-??-??' ! -name "$HOY" | sort | tail -n 1)"
if [ -n "$ULTIMO" ]; then
  rsync -a --delete --link-dest="$ULTIMO" "$RAIZ/adjuntos/" "$ADJUNTOS/$HOY/"
else
  rsync -a --delete "$RAIZ/adjuntos/" "$ADJUNTOS/$HOY/"
fi
echo "adjuntos: $ADJUNTOS/$HOY"

# días con al menos un respaldo de la base (AAAA-MM-DDTHHMMSS-motivo.sqlite)
DIAS="$(find "$BASE" -maxdepth 1 -type f -name '????-??-??T??????-*.sqlite' -printf '%f\n' | cut -c1-10 | sort -u)"
# sin ningún respaldo de la base (carpeta vacía, máquina nueva) no se borra nada: no hay con qué comparar
[ -n "$DIAS" ] || echo "sin respaldos de la base: no se rotan los adjuntos"
while IFS= read -r carpeta; do
  [ -n "$DIAS" ] || continue
  dia="$(basename "$carpeta")"
  if [ "$dia" != "$HOY" ] && ! grep -qx "$dia" <<< "$DIAS"; then
    rm -rf -- "${ADJUNTOS:?}/$dia"
    echo "adjuntos rotados: $dia"
  fi
done < <(find "$ADJUNTOS" -mindepth 1 -maxdepth 1 -type d -name '????-??-??')
if [ "$fallo" != "0" ]; then
  echo "== ERROR: falló el respaldo de la base (ver arriba)" >&2
  exit 1
fi
echo "== listo"
