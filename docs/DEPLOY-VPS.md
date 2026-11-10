# Despliegue en el VPS

Instancia operativa de Casa Roble POS sobre Dokploy, Docker y Traefik.

## URLs

| Servicio | URL |
|---|---|
| POS | <https://totem.lapizzeria.food> |
| Pedidos en línea | <https://totem.lapizzeria.food/pedir> |
| Cocina (KDS) | <https://totem.lapizzeria.food/cocina> |
| Caja | <https://totem.lapizzeria.food/caja> |
| API | <https://totem.lapizzeria.food/api/health> |
| Panel Dokploy | <https://admin.lapizzeria.food> |

## Arquitectura

```text
Internet
   │
   ▼
Traefik (Docker, 80/443, Let's Encrypt)
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
- **Persistencia:** volumen Docker `restpos_data`, montado en `/data`; SQLite en `/data/restpos.db` (WAL) y archivos en `/data/uploads` (fotos de productos y comprobantes de pago).
- **Fuente para rebuild:** `/home/ubuntu/restpos-build`.

## DNS

Ambos registros apuntan al VPS:

```text
totem.lapizzeria.food  A  40.160.39.1
admin.lapizzeria.food  A  40.160.39.1
```

Traefik gestiona y renueva los certificados de Let's Encrypt.

## Seguridad

- **La autenticación del POS es propia de la aplicación:** cada empleado entra con su nombre y PIN; hay roles y sesiones.
- **Comprobantes y fotos:** los archivos se guardan fuera de la base, en `/data/uploads`, y sobreviven a los reinicios junto con el volumen.
- La cookie `restpos_session` es `HttpOnly`, `SameSite=Lax` y `Secure` en producción (`COOKIE_SECURE=true`).
- La página pública `/pedir` y los endpoints `/api/public/*` están abiertos sin sesión por diseño. Todo lo demás exige una sesión válida.
- Los PIN se guardan con `scrypt`; los tokens de sesión se guardan como hash SHA-256.
- Hay límite de intentos por empleado y por IP.
- El tráfico está cifrado con Let's Encrypt y HSTS. Se mantienen `X-Content-Type-Options`, `Referrer-Policy`, `frameDeny` y `contentTypeNosniff`.
- El panel Dokploy solo se publica en `https://admin.lapizzeria.food`; el puerto 3000 está bloqueado desde Internet.
- UFW permite únicamente `22`, `80` y `443`.
- Docker puede saltarse UFW. La unidad `restpos-firewall.service` ejecuta `/usr/local/sbin/restpos-firewall`, que agrega una regla persistente en `DOCKER-USER` (IPv4 e IPv6) para bloquear el puerto 3000. La unidad se reinicia junto con Docker.
- El password SSH sigue habilitado. Se recomienda configurar una clave propia y desactivar `PasswordAuthentication` una vez verificada.
- El panel de Dokploy equivale a acceso root al host (Docker socket). Usa una contraseña fuerte y no la compartas.

### Autenticación en Traefik

La versión 2 eliminó el Basic Auth compartido del dominio del POS. Ahora la autenticación de empleados es la de la aplicación y `/pedir` debe poder abrirse sin credenciales de proxy.

La configuración de Traefik debe conservar el middleware de seguridad:

```text
traefik.http.routers.restpos-h7kjj3-1-websecure.middlewares=restpos-security@file
```

No vuelvas a añadir `restpos-auth@file` al router del POS. El archivo dinámico `/etc/dokploy/traefik/dynamic/restpos-auth.yml` conserva `restpos-security`; las credenciales Basic Auth ya no se usan para el POS.

## Primer arranque tras un despliegue limpio

La base incluye menú, áreas, mesas y modificadores, pero **no incluye empleados**. La primera vez:

1. Abre <https://totem.lapizzeria.food/login>.
2. Verás **Crea tu administrador**.
3. Captura nombre y un PIN de 6 a 8 dígitos (recomendado).
4. Después podrás crear cajeros, meseros y cocina desde **Administración → Equipo**.

No compartas la base sin antes revisar los empleados y PINs. Si se pierde el acceso, usa el procedimiento de recuperación.

### Recuperar el PIN de un administrador

Con la app detenida o desde el contenedor del API:

```bash
cd /home/ubuntu/restpos-build
sudo docker compose -p restpos-h7kjj3 exec api \
  node server/scripts/reset-admin-pin.js "Administrador" 123456
```

Esto restablece el PIN, reactiva la cuenta, la deja como `admin` y elimina sus sesiones. En local:

```bash
npm run admin:reset-pin -w server -- "Administrador" 123456
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
- Los respaldos son locales. Cópialos periódicamente a otro servidor o almacenamiento S3.

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

3. Arranca de nuevo el servicio y comprueba `/api/health`, el login, el historial y las mesas.

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

El `Dockerfile` activa `NEXT_OUTPUT=standalone` solo en la etapa de build de la web. En local, `next start` sigue funcionando sin esa variable.

Recrea los contenedores:

```bash
cd /etc/dokploy/compose/restpos-h7kjj3/code
sudo docker compose -p restpos-h7kjj3 --env-file .env up -d --force-recreate
```

No uses `down -v` en producción: eliminaría el volumen de SQLite.

### Variables de producción

El compose del stack del API debe incluir:

```yaml
NODE_ENV: production
DATABASE_PATH: /data/restpos.db
UPLOAD_DIR: /data/uploads
APP_TIMEZONE: America/Mexico_City
TAX_RATE_BPS: "1600"
COOKIE_SECURE: "true"
SESSION_TTL_HOURS: "12"
```

`UPLOAD_DIR` es opcional: por defecto se usa la carpeta `uploads` junto a la base de datos, que en el volumen es `/data/uploads`.

El frontend necesita `API_URL=http://api:4000` y `PORT=3000`.

## Migración de métodos de pago

La versión con métodos de pago configurables migra automáticamente las tablas antiguas de pedidos y pagos para permitir códigos como `sinpe` y `transferencia`. El proceso:

1. Hace una copia lógica de pedidos y pagos.
2. Reconstruye las tablas sin la restricción antigua de métodos.
3. Conserva pagos históricos y les asigna un nombre visible.
4. Crea los métodos iniciales de Costa Rica.

Antes de actualizar, ejecuta un respaldo manual. Después del arranque verifica que el historial y los turnos anteriores siguen visibles.

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

Comprobaciones rápidas:

```bash
curl -fsS https://totem.lapizzeria.food/api/health
curl -I https://totem.lapizzeria.food/
curl -I https://totem.lapizzeria.food/pedir
```

## Impresión térmica

La impresora debe ser ESC/POS y aceptar conexiones TCP en el puerto 9100 (o el configurado), accesible desde el contenedor del API.

- Configura **cocina** y **tickets** por separado en **Administración → Ajustes**.
- La comanda se envía al pulsar **Enviar a cocina** si `auto_print_kitchen` está activo.
- El ticket del cliente se imprime desde el POS o desde `/recibo/:id`.
- Prueba desde la red del servidor:

```bash
nc -vz 192.168.1.50 9100
```

## Limitaciones actuales

- Las imágenes viven solo en el VPS. Si se destruye el servidor hay que reconstruirlas desde este repositorio.
- SQLite es apropiado para una sola terminal o pocas terminales; no escales la API a varias réplicas.
- No hay pasarela de pago: la terminal bancaria es externa.
- No hay inventario ni recetas.
- No hay backup externo automático todavía.
- Si cambia el volumen de ventas o se requieren varias cajas/sucursales, el siguiente paso es migrar a PostgreSQL y añadir sincronización en tiempo real.
