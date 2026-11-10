# Despliegue en el VPS

Instancia operativa de Casa Roble POS sobre Dokploy.

## URLs

| Servicio | URL |
|---|---|
| POS | <https://totem.lapizzeria.food> |
| Panel Dokploy | <https://admin.lapizzeria.food> |
| API (misma origen) | <https://totem.lapizzeria.food/api/health> |

> Las credenciales de acceso al POS y al panel se entregan por un canal separado. No están escritas en este repositorio.

## Arquitectura

```text
Internet
   │
   ▼
Traefik (Docker, puertos 80/443, Let's Encrypt)
   ├── admin.lapizzeria.food → Dokploy :3000
   └── totem.lapizzeria.food → web (Next.js :3000)
                                  └── /api → api (Express :4000)
                                                   └── volumen restpos_data
                                                       /data/restpos.db
```

- **Servidor:** VPS OVH, Ubuntu 22.04.5 LTS, 3.7 GB RAM, 37 GB de disco, swap de 2 GB.
- **Docker Engine:** 28.5.0.
- **Dokploy:** v0.31.0.
- **Traefik:** v3.6.25.
- **Proyecto Dokploy:** `RestPost`.
- **Stack:** `restpos` (`appName: restpos-h7kjj3`), compose en modo `docker-compose`.
- **Imágenes locales:** `restpos-api:latest` y `restpos-web:latest`.
- **Persistencia:** volumen Docker `restpos_data`, montado en `/data`; SQLite en `/data/restpos.db`.
- **Fuente para rebuild:** `/home/ubuntu/restpos-build`.

## DNS

Ambos registros apuntan al VPS:

```text
totem.lapizzeria.food  A  40.160.39.1
admin.lapizzeria.food  A  40.160.39.1
```

Los certificados Let's Encrypt los gestiona Traefik y se renuevan automáticamente.

## Seguridad

- La app está detrás de **HTTP Basic Auth** en Traefik. Todo el POS, API, historial y tickets exigen autenticación.
- Se añaden cabeceras HSTS y de seguridad desde Traefik.
- El panel Dokploy solo se publica por `https://admin.lapizzeria.food`; el puerto 3000 está bloqueado desde Internet.
- UFW permite únicamente `22`, `80` y `443`.
- Debido a que Docker puede saltarse UFW, la unidad `restpos-firewall.service` ejecuta `/usr/local/sbin/restpos-firewall`, que detecta la interfaz pública y agrega una regla en `DOCKER-USER` (IPv4 e IPv6) para bloquear el puerto 3000. La unidad se reinicia junto con Docker.
- El password SSH sigue habilitado. Se recomienda configurar una clave propia y desactivar `PasswordAuthentication` cuando esté verificada.
- El acceso al panel es equivalente a acceso root al host (Docker socket). Usa una contraseña fuerte y no lo compartas.

### Cambiar la contraseña del POS

En el VPS:

```bash
HASH="$(openssl passwd -apr1 'NUEVA_CONTRASEÑA')"
sudo cp /etc/dokploy/traefik/dynamic/restpos-auth.yml /root/restpos-auth.yml.bak
printf "http:\n  middlewares:\n    restpos-auth:\n      basicAuth:\n        users:\n          - 'casaroble:%s'\n    restpos-security:\n      headers:\n        stsSeconds: 31536000\n        stsIncludeSubdomains: true\n        stsPreload: true\n        contentTypeNosniff: true\n        frameDeny: true\n        referrerPolicy: strict-origin-when-cross-origin\n" "$HASH" | sudo tee /etc/dokploy/traefik/dynamic/restpos-auth.yml >/dev/null
```

Traefik recarga el archivo automáticamente. Verifica con:

```bash
curl -I https://totem.lapizzeria.food/
```

## Respaldos

Script instalado en el VPS:

```text
/usr/local/sbin/restpos-backup
```

- Usa `VACUUM INTO` sobre SQLite para generar una copia consistente sin detener la venta.
- Comprime el archivo en `/home/ubuntu/restpos-backups/`.
- Conserva 14 días.
- Cron diario a las **09:00 UTC** (03:00 en Ciudad de México).
- Los respaldos son locales. Se recomienda copiarlos periódicamente a otro servidor o almacenamiento S3.

Ejecutar uno manualmente:

```bash
sudo /usr/local/sbin/restpos-backup
sudo ls -lh /home/ubuntu/restpos-backups
```

### Restaurar un respaldo

1. Detén el servicio desde Dokploy o con:

```bash
cd /etc/dokploy/compose/restpos-h7kjj3/code
sudo docker compose -p restpos-h7kjj3 --env-file .env stop api
```

2. Copia el respaldo descomprimido al volumen:

```bash
sudo bash -c '
  set -e
  VOL=/var/lib/docker/volumes/restpos_data/_data
  cp -a "$VOL/restpos.db" "/root/restpos-antes-de-restaurar.db" 2>/dev/null || true
  gzip -dc /home/ubuntu/restpos-backups/ARCHIVO.db.gz > "$VOL/restpos.db"
  rm -f "$VOL/restpos.db-wal" "$VOL/restpos.db-shm"
  chown 1000:1000 "$VOL/restpos.db"
'
```

3. Arranca de nuevo el servicio y comprueba `/api/health`, el historial y las mesas.

## Actualizar la aplicación

Desde la máquina de desarrollo, sincroniza el código:

```bash
rsync -az --delete \
  --exclude node_modules --exclude '**/node_modules' \
  --exclude .next --exclude '**/.next' --exclude .git \
  --exclude .npm-cache --exclude .artifacts --exclude .deploy \
  --exclude 'server/data/*.db*' \
  -e "ssh -i .deploy/restpos_deploy" \
  ./ ubuntu@40.160.39.1:/home/ubuntu/restpos-build/
```

Reconstruye las imágenes en el VPS:

```bash
ssh -i .deploy/restpos_deploy ubuntu@40.160.39.1
cd /home/ubuntu/restpos-build
sudo docker build --target api -t restpos-api:latest .
sudo docker build --target web -t restpos-web:latest .
```

Después, desde Dokploy pulsa **Deploy** en el stack `restpos`, o fuerza la recreación:

```bash
cd /etc/dokploy/compose/restpos-h7kjj3/code
sudo docker compose -p restpos-h7kjj3 --env-file .env up -d --force-recreate
```

No uses `down -v` en producción: eliminaría el volumen de SQLite.

## Logs y salud

```bash
sudo docker ps
sudo docker logs -f restpos-h7kjj3-web-1
sudo docker logs -f restpos-h7kjj3-api-1
sudo docker logs --tail 100 dokploy-traefik
```

Los despliegues de Dokploy quedan en:

```text
/etc/dokploy/logs/restpos-h7kjj3/
```

## Limitaciones actuales

- Las imágenes viven solo en el VPS. Si se destruye el servidor hay que reconstruirlas desde este repositorio.
- SQLite es apropiado para una sola terminal o pocas terminales; no escales la API a varias réplicas.
- El Basic Auth es compartido; no identifica a cada empleado.
- No hay backup externo automático todavía.
- Si cambia el volumen de ventas o se requieren varias cajas, el siguiente paso es migrar a PostgreSQL y añadir autenticación por usuario.
