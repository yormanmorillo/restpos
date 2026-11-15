# Despliegue en el VPS

Instancia operativa de Casa Roble POS sobre Dokploy, Docker y Traefik.

## URLs

| Servicio | URL |
|---|---|
| POS | <https://pos.example.com> |
| Pedidos en línea | <https://pos.example.com/pedir> |
| Cocina (KDS) | <https://pos.example.com/cocina> |
| Caja | <https://pos.example.com/caja> |
| API | <https://pos.example.com/api/health> |
| Panel Dokploy | <https://panel.example.com> |

## Arquitectura

```text
Internet
   │
   ▼
Traefik (Docker, 80/443, Let's Encrypt)
   ├── panel.example.com → Dokploy :3000
   └── pos.example.com → web (Next.js :3000)
                                  └── /api → api (Express :4000)
                                                   └── volumen restpos_data
                                                       /data/restpos.db
```

- **Servidor:** VPS OVH, Ubuntu 22.04.5 LTS, 3.7 GB RAM, 37 GB de disco, swap de 2 GB.
- **Docker Engine:** 28.5.0.
- **Dokploy:** v0.31.0.
- **Traefik:** v3.6.25.
- **Proyecto Dokploy:** `RestPost`.
- **Stack:** `restpos` (`appName: restpos-demo`), compose en modo `docker-compose`.
- **Imágenes locales:** `restpos-api:latest` y `restpos-web:latest`.
- **Persistencia:** volumen Docker `restpos_data`, montado en `/data`; SQLite en `/data/restpos.db` (WAL) y archivos en `/data/uploads` (fotos de productos y comprobantes de pago).
- **Fuente para rebuild:** `/srv/restpos`.

## DNS

Ambos registros apuntan al VPS:

```text
pos.example.com  A  203.0.113.10
panel.example.com  A  203.0.113.10
```

Traefik gestiona y renueva los certificados de Let's Encrypt.

## Seguridad

- **La autenticación del POS es propia de la aplicación:** cada empleado entra con su nombre y PIN; hay roles y sesiones.
- **Comprobantes y fotos:** los archivos se guardan fuera de la base, en `/data/uploads`, y sobreviven a los reinicios junto con el volumen.
- **Propietario del software:** el rol `owner` es distinto del gerente de tienda (`admin`). Solo el propietario puede administrar integraciones y crear otros propietarios.
- La cookie `restpos_session` es `HttpOnly`, `SameSite=Lax` y `Secure` en producción (`COOKIE_SECURE=true`).
- La página pública `/pedir` y los endpoints `/api/public/*` están abiertos sin sesión por diseño. Todo lo demás exige una sesión válida.
- Los PIN se guardan con `scrypt`; los tokens de sesión se guardan como hash SHA-256.
- Hay límite de intentos por empleado y por IP.
- El tráfico está cifrado con Let's Encrypt y HSTS. Se mantienen `X-Content-Type-Options`, `Referrer-Policy`, `frameDeny` y `contentTypeNosniff`.
- El panel Dokploy solo se publica en `https://panel.example.com`; el puerto 3000 está bloqueado desde Internet.
- UFW permite únicamente `22`, `80` y `443`.
- Docker puede saltarse UFW. La unidad `restpos-firewall.service` ejecuta `/usr/local/sbin/restpos-firewall`, que agrega una regla persistente en `DOCKER-USER` (IPv4 e IPv6) para bloquear el puerto 3000. La unidad se reinicia junto con Docker.
- La autenticación SSH por contraseña está deshabilitada. Usa únicamente llaves y restringe el acceso al panel por VPN o IP allowlist.
- El panel de Dokploy equivale a acceso root al host (Docker socket). Usa una contraseña fuerte y no la compartas.

### Autenticación en Traefik

La versión 2 eliminó el Basic Auth compartido del dominio del POS. Ahora la autenticación de empleados es la de la aplicación y `/pedir` debe poder abrirse sin credenciales de proxy.

La configuración de Traefik debe conservar el middleware de seguridad:

```text
traefik.http.routers.restpos-demo-1-websecure.middlewares=restpos-security@file
```

No vuelvas a añadir `restpos-auth@file` al router del POS. El archivo dinámico `/etc/dokploy/traefik/dynamic/restpos-auth.yml` conserva `restpos-security`; las credenciales Basic Auth ya no se usan para el POS.

## Primer arranque tras un despliegue limpio

La base incluye menú, áreas, mesas y modificadores, pero **no incluye empleados**. La primera vez:

1. Abre <https://pos.example.com/login>.
2. Verás **Crea tu administrador**.
3. Captura nombre y un PIN de exactamente 6 dígitos. Se rechazan PINs repetidos o secuenciales.
4. Después podrás crear cajeros, meseros y cocina desde **Administración → Equipo**.

No compartas la base sin antes revisar los empleados y PINs. Si se pierde el acceso, usa el procedimiento de recuperación.

### Crear la cuenta del propietario del software

Define `PIN_SEGURO` con exactamente 6 dígitos no triviales:

```bash
export PIN_SEGURO='...'
```

El propietario (`owner`) tiene un panel propio en `/owner` para nombre del restaurante, métodos de pago, integraciones y accesos. Créalo desde consola:

```bash
cd /srv/restpos
sudo docker compose -p restpos-demo exec api \
  node server/scripts/create-owner.js "MATMAX Admin" "$PIN_SEGURO"
```

El propietario aparece en el login como un empleado más. El gerente de tienda conserva el rol `admin`.

### Recuperar el PIN de un administrador

Para un propietario, usa el mismo comando `create-owner` con su nombre y un PIN nuevo.

Con la app detenida o desde el contenedor del API:

```bash
cd /srv/restpos
sudo docker compose -p restpos-demo exec api \
  node server/scripts/reset-admin-pin.js "Administrador" "$PIN_SEGURO"
```

Esto restablece el PIN, reactiva la cuenta, la deja como `admin` y elimina sus sesiones. En local:

```bash
npm run admin:reset-pin -w server -- "Administrador" "$PIN_SEGURO"
```

## Respaldos

Script instalado en el VPS:

```text
/usr/local/sbin/restpos-backup
```

- Usa `VACUUM INTO` sobre SQLite para generar una copia consistente sin detener la venta.
- Genera un respaldo `.db.gz` de SQLite y un `.tar.gz` del directorio `/data/uploads` (fotos de productos y comprobantes).
- Guarda ambos en `/home/ubuntu/restpos-backups/`.
- Conserva 14 días.
- Cron diario a las **09:00 UTC** (03:00 en Costa Rica).
- Los respaldos son locales. Cópialos periódicamente a otro servidor o almacenamiento S3.

Ejecutar uno manualmente:

```bash
sudo /usr/local/sbin/restpos-backup
sudo ls -lh /home/ubuntu/restpos-backups
```

### Restaurar un respaldo

1. Detén el servicio desde Dokploy o con:

```bash
cd /etc/dokploy/compose/restpos-demo/code
sudo docker compose -p restpos-demo --env-file .env stop api
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

3. Restaura las fotos si el respaldo incluye `restpos-uploads-*.tar.gz`:

```bash
sudo bash -c '
  set -e
  VOL=/var/lib/docker/volumes/restpos_data/_data
  mkdir -p "$VOL/uploads"
  tar -xzf /home/ubuntu/restpos-backups/restpos-uploads-ARCHIVO.tar.gz -C "$VOL"
  chown -R 1000:1000 "$VOL/uploads"
'
```

4. Arranca de nuevo el servicio y comprueba `/api/health`, el login, el historial, las fotos y las mesas.

## Actualizar la aplicación

Desde la máquina de desarrollo, sincroniza el código:

```bash
rsync -az --delete \
  --exclude node_modules --exclude '**/node_modules' \
  --exclude .next --exclude '**/.next' --exclude .git \
  --exclude .npm-cache --exclude .artifacts --exclude .deploy \
  --exclude 'server/data/*.db*' \
  -e "ssh -i .deploy/deploy_key" \
  ./ ubuntu@203.0.113.10:/srv/restpos/
```

Reconstruye las imágenes en el VPS:

```bash
ssh -i .deploy/deploy_key ubuntu@203.0.113.10
cd /srv/restpos
sudo docker build --target api -t restpos-api:latest .
sudo docker build --target web -t restpos-web:latest .
```

El `Dockerfile` activa `NEXT_OUTPUT=standalone` solo en la etapa de build de la web. En local, `next start` sigue funcionando sin esa variable.

Recrea los contenedores:

```bash
cd /etc/dokploy/compose/restpos-demo/code
sudo docker compose -p restpos-demo --env-file .env up -d --force-recreate
```

No uses `down -v` en producción: eliminaría el volumen de SQLite.

### Variables de producción

El compose del stack del API debe incluir:

```yaml
NODE_ENV: production
DATABASE_PATH: /data/restpos.db
UPLOAD_DIR: /data/uploads
APP_TIMEZONE: America/Costa_Rica
APP_COUNTRY: CR
APP_CURRENCY: CRC
TAX_RATE_BPS: "1300"
COOKIE_SECURE: "true"
SESSION_TTL_HOURS: "12"
```

`UPLOAD_DIR` es opcional: por defecto se usa la carpeta `uploads` junto a la base de datos, que en el volumen es `/data/uploads`.

El frontend necesita `API_URL=http://api:4000` y `PORT=3000`.

## Fase 1

Las funciones `split_bill`, `refunds`, `table_transfer_merge` y `offline_mode` están apagadas por defecto. Actívalas desde **Ajustes → Funciones activables**. Los reembolsos requieren un PIN de gerente/admin/owner y un turno abierto si devuelven efectivo. La primera versión de offline (PWA + ventas para llevar en efectivo) está en [OFFLINE-MODE.md](OFFLINE-MODE.md). Activa la bandera y abre el POS con conexión una vez para cachear el menú y el service worker.

## Funciones activables

El super admin activa o desactiva módulos desde **Administración → Ajustes → Funciones activables**. Las banderas se guardan en `settings` con el prefijo `feature_`. Los módulos existentes nacen activos; las funciones futuras nacen apagadas. Si se apaga una función, su API devuelve 404 y la interfaz oculta el acceso.

## Impresoras de red

Además de bloquear loopback, link-local y metadatos, la impresora debe estar en **Hosts autorizados** (IPs o nombres separados por coma). Sin esa lista, una IP privada no puede imprimir.

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
sudo docker logs -f restpos-demo-web-1
sudo docker logs -f restpos-demo-api-1
sudo docker logs --tail 100 dokploy-traefik
```

Los despliegues de Dokploy quedan en:

```text
/etc/dokploy/logs/restpos-demo/
```

Comprobaciones rápidas:

```bash
curl -fsS https://pos.example.com/api/health
curl -I https://pos.example.com/
curl -I https://pos.example.com/pedir
```

## Endurecimiento

- Configura `TRUST_PROXY_HOPS=1` cuando la API esté detrás de Traefik; no uses `trust proxy` abierto.
- Define `SETUP_TOKEN` en despliegues nuevos. Sin ese token, el primer visitante podría reclamar la instalación.
- Mantén el repositorio privado; no publiques IPs, dominios, llaves ni credenciales.
- La autenticación SSH por contraseña está deshabilitada; usa llaves y restringe Dokploy por VPN/IP.

## Impresión térmica

Se admiten dos modos en **Administración → Ajustes**:

1. **Red TCP / ESC-POS:** impresora conectada por Ethernet/WiFi, puerto 9100. Compatible con papel de **58 mm** o **80 mm**.
2. **Navegador / impresora instalada:** usa el diálogo del dispositivo. Funciona con cualquier impresora térmica instalada por USB, Bluetooth o red mediante su controlador.

En modo red:

- Configura **cocina** y **tickets** por separado.
- La comanda se envía al pulsar **Enviar a cocina** si `auto_print_kitchen` está activo.
- El ticket del cliente se imprime desde el POS o desde `/recibo/:id`.
- Prueba desde la red del servidor:

```bash
nc -vz 192.168.1.50 9100
```

En modo navegador, usa **Imprimir ticket** o **Imprimir** en la vista de la factura; el sistema abre el diálogo del sistema operativo.

## Inventario y recetas

- **Inventario → Stock**: crea insumos (g, ml, pz), registra entradas de mercancía y ajustes de conteo.
- **Inventario → Recetas**: asigna a cada producto los insumos y cantidades que consume una unidad vendida.
- Al cobrar un pedido, los ingredientes se descuentan automáticamente en la misma transacción del pago.
- Los insumos bajo mínimo se marcan en rojo. Se permite stock negativo para no bloquear la venta; revisa los movimientos y ajusta.
- La importación masiva de productos CSV está en **Administración → Menú → Carga masiva**.

## Integraciones externas

El propietario puede guardar URL base, tipo de autenticación y token de futuros proveedores en **Propietario → Integraciones**. Esta versión **no envía datos todavía**; el conector debe implementarse antes de activar la integración. Los tokens se guardan en la base de datos: protege el acceso al panel y los respaldos.

## Factura por WhatsApp

Desde el cobro, el ticket o el historial se genera un enlace público `/r/<token>` con la factura. El botón **WhatsApp** abre WhatsApp con el resumen y el enlace. El enlace no expone teléfono, dirección ni datos internos del cliente.

## Limitaciones actuales

- Las imágenes viven solo en el VPS. Si se destruye el servidor hay que reconstruirlas desde este repositorio.
- SQLite es apropiado para una sola terminal o pocas terminales; no escales la API a varias réplicas.
- No hay pasarela de pago: la terminal bancaria es externa.
- El inventario descuenta ingredientes solo para productos con receta configurada; revisa movimientos y ajusta conteos periódicamente.
- No hay backup externo automático todavía.
- Si cambia el volumen de ventas o se requieren varias cajas/sucursales, el siguiente paso es migrar a PostgreSQL y añadir sincronización en tiempo real.
