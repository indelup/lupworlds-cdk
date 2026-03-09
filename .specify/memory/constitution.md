# Lupworlds Constitution

Lupworlds es una plataforma gacha para streamers: los viewers coleccionan assets (personajes, materiales) mediante redeems de canal en Twitch. El streamer administra su mundo, sus banners y sus assets. El bot interno ejecuta los pulls. El overlay embebido en OBS muestra los resultados en tiempo real.

---

## Core Principles

### I. Serverless-First (NON-NEGOTIABLE)
Toda la infraestructura vive en AWS bajo el paradigma serverless: Lambda + API Gateway + DynamoDB + S3. No se despliegan servidores gestionados. El IaC es **CDK en TypeScript**. Ningún recurso se crea fuera del stack CDK. Cambios de infraestructura requieren `cdk diff` antes de `cdk deploy`.

### II. Type-Contract Driven Development
Existe un paquete compartido de tipos (`lupworlds-types` o equivalente) que es la **fuente de verdad del dominio**. El backend (CDK/Lambda) y el frontend deben seguir esos tipos. Si un tipo cambia en el paquete compartido, todos los consumidores deben actualizarse en el mismo PR. No se permiten tipos duplicados ni divergentes entre proyectos.

### III. Resource-Based Modularity
Cada entidad del dominio tiene su propio módulo en `apiProxyLambda/resources/`. Un recurso = un archivo = un router Hono. Las responsabilidades de un módulo son: CRUD de su entidad, manejo de imágenes en S3, y nada más. La lógica de negocio cross-entidad (ej: gacha pull) va en un módulo propio, no mezclada en recursos existentes.

### IV. Platform-Agnostic Identity
El backend de Lupworlds es el **identity provider**. El flujo de auth siempre es:
```
OAuth externo (Twitch/YouTube/otro) → Backend verifica → crea/encuentra usuario interno → emite JWT propio
```
Los IDs internos (`User.id`) son estables y permanentes. Los IDs de plataforma (`twitchId`, etc.) son atributos federados. El JWT emitido por el backend contiene: `sub` (userId interno), `platform`, `platformId`, `allowedRoles`, `ownedWorldIds`. **Nunca** se expone el token de Twitch/OAuth al cliente más allá del intercambio inicial.

### V. World-Scoped RBAC
Los permisos se evalúan por recurso y por mundo. Las reglas son:

| Recurso | `streamer` (mundo propio) | `viewer` | `bot` (service) | `overlay` (service) |
|---|---|---|---|---|
| Characters / Materials / Actions / Banners GET | ✓ | ✓ | ✓ | ✓ |
| Characters / Materials / Actions / Banners POST/PUT/DELETE | ✓ | ✗ | ✓ | ✗ |
| Worlds GET | ✓ | ✓ | ✓ | ✓ |
| Worlds PUT/DELETE | ✓ (solo el suyo) | ✗ | ✓ | ✗ |
| PlayerWorldData GET | ✓ | ✓ (solo el suyo) | ✓ | ✓ |
| PlayerWorldData PUT | ✓ | ✓ (solo el suyo) | ✓ | ✗ |
| Users GET/PUT | ✓ (solo el suyo) | ✓ (solo el suyo) | ✓ | ✗ |

Un usuario tiene rol `streamer` en un mundo si `worldId` pertenece a su `ownedWorldIds`. En cualquier otro mundo, opera como `viewer`. Los roles `bot` y `overlay` son credenciales de servicio, no roles de usuario.

### VI. Gacha Server-Side Only (NON-NEGOTIABLE)
Toda lógica de pull (probabilidades, pity, selección de items) se ejecuta **únicamente en el backend**. El bot llama al backend con el evento de redeem; el backend resuelve el pull y persiste el resultado. El cliente (overlay/frontend) solo consume el resultado ya determinado. Nunca se envían probabilidades brutas al cliente.

### VII. Simplicity & YAGNI
Se construye solo lo necesario para el sprint actual. Las entidades `Shop`, `Currency`, `Pity` y `Decorations` existen como visión futura en los tipos pero **no se implementan hasta ser priorizadas**. No se crean abstracciones, helpers ni capas adicionales sin necesidad demostrada.

---

## Domain Model

### Entidades activas (implementadas)
- **User**: Usuario con `allowedRoles: ROLE[]`, `ownedWorldIds: string[]`, federado por `twitchId`
- **World**: Mundo de un streamer con assets visuales, `cardBacks` por rareza, `redeems` (channel points → banner)
- **Character / Material**: Assets coleccionables con rareza, artist, descripción, imágenes en S3
- **Banner**: Agrupa `BannerBag[]` con probabilidades de drop. Define qué se puede obtener en un pull
- **Action**: Evento o habilidad disponible en un mundo
- **PlayerWorldData**: Inventario del viewer por mundo (`GachaItem[]` de characters y materials)

### Servicios internos
- **Bot**: Proceso persistente que corre en un servidor propio (no Lambda). Escucha eventos de Twitch de forma autónoma y ejecuta los pulls internamente cuando se detecta un redeem. El frontend expone un control de encendido/apagado que envía una señal al bot. El bot llama a la API de Lupworlds (con sus credenciales de servicio) para persistir resultados. Sus credenciales se almacenan en **SSM Parameter Store (SecureString)**. No tiene cuenta de usuario en el sistema.
- **Overlay**: Página web embebible en OBS. Recibe un JWT de solo lectura (`scope: read`) scoped a un `worldId`, generado por el streamer desde el dashboard. Sin capacidad de escritura por diseño.

### Entidades de visión futura (no implementar hasta priorizar)
- `Shop`, `ShopItem`, `Currency`, `Pity` (PULL/SHOP modes), `Decorations`

---

## Security & Infrastructure Rules

### Secrets y credenciales
- Credenciales del bot: **SSM Parameter Store SecureString** (ej: `/lupworlds/bot/api-key`). Nunca en variables de entorno en texto plano.
- Tokens de overlay: JWT de corta duración (24h renovable) emitido por el backend, scoped a `worldId`.
- Las variables de entorno de Lambda solo contienen nombres de recursos (table names, bucket names), nunca secrets.

### Infraestructura CDK
- Las políticas `RemovalPolicy.DESTROY` y `autoDeleteObjects: true` son **solo para dev**. Producción requiere políticas de retención explícitas.
- El CORS origin `http://localhost:8080` debe parametrizarse por environment antes de producción.
- Todo nuevo recurso AWS debe declararse en el stack CDK y recibir los permisos IAM mínimos necesarios (least privilege).
- `cdk diff` es obligatorio antes de cualquier `cdk deploy` a producción.

### Environments
- **Dev**: deployment libre, políticas de destrucción habilitadas
- **Prod** (futuro): stack separado, retention policies, aprobación explícita para cambios destructivos

---

## Development Workflow

### Patrones de código establecidos
- Clientes de DynamoDB y S3 se instancian a **nivel de módulo**, no dentro de handlers
- IDs: `randomUUID()` para todas las entidades excepto Users (que usan su ID de Twitch como base)
- Timestamps: ISO 8601 en `createdAt`
- Formatting: Prettier con 4-space tab width, ESLint con TypeScript plugin
- Naming: tablas PascalCase, variables camelCase, índices con sufijo `Index` (ej: `WorldIdIndex`)

### Manejo de imágenes
- Upload: presigned URL (1h) generada por el backend → cliente sube directamente a S3
- Delete/Update: el backend elimina la imagen anterior de S3 antes de persistir la nueva referencia. Los errores de S3 no bloquean la operación principal (best-effort cleanup).
- Todos los buckets tienen CORS habilitado.

### Testing
- Framework: Jest
- Prioridad actual: tests por feature completada
- Cobertura mínima requerida para recursos de gacha (lógica de probabilidades y pity): tests unitarios obligatorios antes de merge

---

## Governance

Esta constitución supersede cualquier práctica ad-hoc. Cambios a los principios requieren: documentación del motivo, actualización de este archivo, y consideración del impacto en entidades existentes.

Todo PR que agregue un nuevo recurso de dominio, modifique el esquema de DynamoDB, o cambie lógica de gacha debe verificar compliance con esta constitución.

La lógica de gacha y el modelo de permisos son las áreas de mayor riesgo — cualquier cambio en esas secciones requiere revisión explícita.

**Version**: 1.0.0 | **Ratified**: 2026-03-04 | **Last Amended**: 2026-03-04
